// Hub VEREX — Entrega de mercadería y firma digital (entrega y contrato)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
async function abrirEntrega() {
    carritoEntrega = {};
    _scansFallidosSesion = [];
    const wrapFallidos = document.getElementById("escaneos-fallidos-wrap");
    if (wrapFallidos) wrapFallidos.style.display = "none";
    document.getElementById("pantalla-perfil").style.display = "none";
    document.getElementById("pantalla-entrega").style.display = "block";
    document.getElementById("bus-entrega").value = "";
    document.getElementById("grid-entrega").innerHTML = '<p style="color:var(--plateado);font-size:13px;padding:10px;">⏳ Cargando inventario...</p>';

    const titulo = document.getElementById("entrega-titulo");
    const btnMano  = document.getElementById("btn-entrega-en-mano");
    const btnMens  = document.getElementById("btn-entrega-mensajeria");
    const btnVenta = document.getElementById("btn-venta-afiliado");
    const btnBorr  = document.getElementById("btn-guardar-borrador");
    const wrapFechaVA = document.getElementById("wrap-fecha-venta-afiliado");
    const inpFechaVA  = document.getElementById("fecha-venta-afiliado");
    if (_esVentaDirectaAfiliado) {
        if (titulo) titulo.textContent = "💰 Registrar Venta de Afiliado";
        if (btnMano) btnMano.style.display = "none";
        if (btnMens) btnMens.style.display = "none";
        if (btnBorr) btnBorr.style.display = "none";
        if (btnVenta) btnVenta.style.display = "inline-flex";
        if (wrapFechaVA) wrapFechaVA.style.display = "flex";
        if (inpFechaVA) { inpFechaVA.max = new Date().toISOString().slice(0,10); inpFechaVA.value = inpFechaVA.max; }
    } else {
        if (titulo) titulo.textContent = "📦 Nueva Entrega";
        if (btnMano) btnMano.style.display = "";
        if (btnMens) btnMens.style.display = "";
        if (btnBorr) btnBorr.style.display = "";
        if (btnVenta) btnVenta.style.display = "none";
        if (wrapFechaVA) wrapFechaVA.style.display = "none";
    }

    // Refrescar SIEMPRE el stock al abrir — otras pantallas (Etiquetas, Stock)
    // pueden haber sobrescrito stockData/productosDisponibles con datos viejos,
    // y aquí necesitamos ver el inventario de bodega más actual posible.
    try {
        const res = await apiPost({ accion: "STOCK_GET_ALL" });
        stockData = res.stock || [];
        guardarCodigosInactivos(res);
    } catch(e) { if (!stockData.length) stockData = []; }

    // Construir lista a mostrar usando stockData (puede tener múltiples entradas por código/talla)
    // Solo mostrar variantes con stock en bodega > 0
    let prodsFiltrados;
    if (stockData.length > 0) {
        prodsFiltrados = stockData
            .filter(s => (parseInt(s.stock_bodega) || 0) > 0)
            .map(s => {
                // Buscar en productosDisponibles por código Y nombre (para diferenciar tallas)
                const prod = productosDisponibles.find(p =>
                    p.codigo === s.codigo && p.nombre === s.nombre
                ) || productosDisponibles.find(p => p.codigo === s.codigo);
                const base = prod || {};
                return {
                    codigo:      s.codigo || base.codigo || "",
                    nombre:      s.nombre || base.nombre || "",
                    precio:      s.precio || base.precio || base.precioNum || 0,
                    precioNum:   s.precio || base.precio || base.precioNum || 0,
                    img:         s.foto   || base.img    || "",
                    categoria:   s.categoria || base.categoria || "",
                    descripcion: s.descripcion || base.descripcion || "",
                    estado:      s.estado || "bodega",
                    stock_bodega: parseInt(s.stock_bodega) || 0,
                    _fromStock: true
                };
            });
    } else {
        // Si aún no hay stockData, usar productosDisponibles
        prodsFiltrados = productosDisponibles;
    }

    // Mapa COMPLETO e inmutable durante esta sesión de entrega — usado por el
    // escaneo (físico o QR). A diferencia de mapaProductos (que renderGridEntrega
    // reconstruye SOLO con lo visible tras cada filtro de búsqueda, letra por
    // letra mientras el scanner "escribe"), este nunca se reduce, así el
    // producto recién escaneado siempre se encuentra aunque el buscador esté
    // mostrando otra cosa en ese instante.
    mapaProductosCompleto = {};
    const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
    [...prodsFiltrados, ...extras].forEach(p => {
        if (!mapaProductosCompleto[p.codigo]) mapaProductosCompleto[p.codigo] = p;
    });

    renderGridEntrega(prodsFiltrados);
}

let mapaProductos = {};
let mapaProductosCompleto = {};

// ── HELPERS DE CÓDIGO (SOLUCIÓN CORRECTA) ────────────────────────────
// El código COMPLETO es único por variante: "AN-021-T10", "AN-021-T12"
// El código BASE agrupa variantes:           "AN-021"
// La talla se extrae del CÓDIGO, no del nombre → no depende de convenciones de texto

// "AN021T10" → "AN021"   |  "CO005" → "CO005"
function getCodigoBase(codigo) {
    return (codigo || "").replace(/[DCU]?T\d+(\.\d+)?$/i, "").trim();
}

// "AN021T10" → "10"   |  "CO005" → null
function getTallaFromCodigo(codigo) {
    const m = (codigo || "").match(/T(\d+)$/i);
    return m ? m[1] : null;
}

// ID seguro para atributos HTML
function safeId(str) { return (str || "").replace(/[^a-zA-Z0-9]/g, '_'); }

function renderGridEntrega(prods) {
    const grid = document.getElementById("grid-entrega");
    const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
    const todos  = [...prods, ...extras];

    // mapaProductos: clave = código ÚNICO del producto (estable, no cambia al filtrar)
    // prods (stockData) tienen prioridad sobre extras (localStorage) para conservar stock_bodega
    mapaProductos = {};
    todos.forEach(p => {
        if (!mapaProductos[p.codigo]) {
            mapaProductos[p.codigo] = p;
        } else {
            mapaProductos[p.codigo] = { ...p, stock_bodega: mapaProductos[p.codigo].stock_bodega ?? p.stock_bodega };
        }
    });

    // Agrupar por código BASE → una tarjeta por producto físico
    // "AN-021-T10", "AN-021-T12" → grupo "AN-021"
    // "CO-005" → grupo "CO-005"
    const grupos = {};
    const ordenGrupos = [];
    todos.forEach(p => {
        const base = getCodigoBase(p.codigo);
        if (!grupos[base]) { grupos[base] = []; ordenGrupos.push(base); }
        if (!grupos[base].some(x => x.codigo === p.codigo)) grupos[base].push(p);
    });

    grid.innerHTML = ordenGrupos.map(codigoBase => {
        const items = grupos[codigoBase];
        const ref   = items[0]; // referencia para imagen, precio, categoría del grupo
        // Nombre sin talla: preferir campo nombre_base si existe, sino limpiar el string
        const baseName = ref.nombre_base || (ref.nombre || "").replace(/-T\d+$/i, "").replace(/ T\d+$/i, "").trim() || ref.nombre;

        // Stock total en bodega de todas las variantes
        const totalBodega = items.reduce((s, p) => s + (parseInt(p.stock_bodega) || 0), 0);

        // Ocultar productos sin stock en bodega (no se pueden entregar)
        if (totalBodega === 0) return '';
        // Piezas totales en el carrito de este producto
        const totalQtyCarrito = items.reduce((s, p) => s + (carritoEntrega[p.codigo]?.qty || 0), 0);
        // Piezas en consignación activa (buscar por código base para abarcar todas las tallas)
        const enConsig = consignacion
            .filter(c => getCodigoBase(c.codigo) === codigoBase && c.estado === "activo")
            .reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);

        // Badges
        const estadoBadge = totalBodega > 0
            ? `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:3px;background:rgba(39,174,96,0.18);border:1px solid rgba(39,174,96,0.5);border-radius:20px;padding:2px 7px;font-size:10px;color:#2ecc71;font-weight:600;">✅ Bodega: ${totalBodega}</div>`
            : `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:3px;background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.4);border-radius:20px;padding:2px 7px;font-size:10px;color:#e74c3c;font-weight:600;">❌ Sin stock</div>`;
        const consigBadge = enConsig > 0
            ? `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:2px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.4);border-radius:20px;padding:2px 7px;font-size:10px;color:var(--dorado);font-weight:600;">📦 Consig: ${enConsig}</div>`
            : '';

        // Piezas de este producto YA guardadas en borrador para el vendedor actual
        // (aún no entregadas físicamente ni visibles en su link) — avisa para no duplicar.
        const enBorradorVendedor = vendedorActual ? consignacion
            .filter(c => getCodigoBase(c.codigo) === codigoBase && c.estado === "borrador" && c.vendedor === vendedorActual.codigo)
            .reduce((s, c) => s + (parseInt(c.cantidad) || 0), 0) : 0;
        const borradorBadge = enBorradorVendedor > 0
            ? `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:2px;background:rgba(74,111,165,0.18);border:1px solid rgba(74,111,165,0.5);border-radius:20px;padding:2px 7px;font-size:10px;color:#8ab4f0;font-weight:600;">📝 Ya en borrador: ${enBorradorVendedor}</div>`
            : '';

        const cardId = "pc-group-" + safeId(codigoBase);
        const menuId = "pmenu-" + safeId(codigoBase);

        // ¿Tiene variantes por talla? → alguna variante tiene "-T{N}" en el código
        const esTallaProducto = items.some(p => getTallaFromCodigo(p.codigo) !== null);

        let controlSection;
        if (esTallaProducto) {
            // Ordenar tallas numéricamente
            const itemsOrdenados = [...items].sort((a, b) => {
                const ta = parseInt(getTallaFromCodigo(a.codigo) || "0");
                const tb = parseInt(getTallaFromCodigo(b.codigo) || "0");
                return ta - tb;
            });
            const pills = itemsOrdenados.map(p => {
                const talla    = getTallaFromCodigo(p.codigo); // viene del código, no del nombre
                const qty      = carritoEntrega[p.codigo]?.qty || 0;
                const bodega   = parseInt(p.stock_bodega) || 0;
                const isSel    = qty > 0;
                const domId    = safeId(p.codigo);
                return `<div id="pill-${domId}" class="talla-pill" style="display:flex;flex-direction:column;align-items:center;gap:2px;
                        background:${isSel ? 'rgba(201,168,76,0.18)' : 'rgba(0,0,0,0.25)'};
                        border:1px solid ${isSel ? 'var(--dorado)' : 'var(--borde)'};
                        border-radius:8px;padding:5px 3px;min-width:48px;transition:all 0.15s;">
                    <div style="font-size:11px;font-weight:700;color:${isSel ? 'var(--dorado)' : 'var(--blanco)'};">T${talla}</div>
                    <div style="font-size:9px;color:${bodega > 0 ? '#2ecc71' : '#e74c3c'};">×${bodega}</div>
                    <div style="display:flex;align-items:center;gap:2px;margin-top:1px;">
                        <button class="qty-btn talla-pill-btn" style="width:20px;height:20px;font-size:13px;line-height:1;" onclick="cambiarQtyEntrega('${p.codigo}',-1)">−</button>
                        <span id="qty-${domId}" style="min-width:14px;text-align:center;font-size:11px;font-weight:700;">${qty}</span>
                        <button class="qty-btn talla-pill-btn" style="width:20px;height:20px;font-size:13px;line-height:1;" onclick="cambiarQtyEntrega('${p.codigo}',1)">+</button>
                    </div>
                </div>`;
            }).join('');
            controlSection = `<div style="display:flex;flex-wrap:wrap;gap:5px;padding:8px 6px;border-top:1px solid var(--borde);justify-content:center;">${pills}</div>`;
        } else {
            // Sin tallas → control simple
            const qty   = carritoEntrega[ref.codigo]?.qty || 0;
            const domId = safeId(ref.codigo);
            controlSection = `<div class="prod-card-qty">
                <button class="qty-btn" onclick="cambiarQtyEntrega('${ref.codigo}',-1)">−</button>
                <span class="qty-num" id="qty-${domId}">${qty}</span>
                <button class="qty-btn" onclick="cambiarQtyEntrega('${ref.codigo}',1)">+</button>
            </div>`;
        }

        return `<div class="prod-card ${totalQtyCarrito > 0 ? 'seleccionado' : ''}" id="${cardId}" style="position:relative;">
            <button class="menu-punto-btn" onclick="event.stopPropagation();toggleMenuProducto('${menuId}')"
                style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:24px;height:24px;font-size:13px;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center;">⋯</button>
            <div id="${menuId}" style="display:none;position:absolute;top:32px;right:6px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;z-index:10;min-width:130px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
                <button onclick="event.stopPropagation();verProducto('${ref.codigo}')"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:var(--blanco);font-size:13px;cursor:pointer;text-align:left;border-bottom:1px solid var(--borde);">✏️ Ver / Editar</button>
                <button onclick="event.stopPropagation();eliminarProductoCatalogo('${ref.codigo}')"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:#e74c3c;font-size:13px;cursor:pointer;text-align:left;">🗑️ Eliminar</button>
            </div>
            <img src="${ikFoto(ref.img, 400) || ''}" onerror="this.style.display='none'" onclick="verProducto('${ref.codigo}')" style="cursor:pointer;">
            <div class="prod-card-info" onclick="verProducto('${ref.codigo}')" style="cursor:pointer;">
                <div class="prod-card-codigo">${sanitizar(codigoBase)}</div>
                <div class="prod-card-nombre">${sanitizar(baseName)}</div>
                <div class="prod-card-precio">$${parseFloat(ref.precio||ref.precioNum||0).toFixed(2)}</div>
                ${estadoBadge}${consigBadge}${borradorBadge}
            </div>
            ${controlSection}
        </div>`;
    }).join('');
}

function cambiarQtyEntrega(codigo, delta) {
    // Corrección: clave = código único (estable, no cambia al filtrar ni reordenar).
    // Si el buscador está filtrado (p.ej. a media escritura de un scanner), el
    // producto puede no estar en mapaProductos (vista actual) pero sí en
    // mapaProductosCompleto (inventario completo de esta sesión de entrega).
    const prod = mapaProductos[codigo] || mapaProductosCompleto[codigo];
    if (!prod) return;
    if (!mapaProductos[codigo]) mapaProductos[codigo] = prod;
    if (!carritoEntrega[codigo]) carritoEntrega[codigo] = { item: prod, qty: 0 };
    const maxStock = !isNaN(parseInt(prod.stock_bodega)) ? parseInt(prod.stock_bodega) : 0;
    const newQty   = carritoEntrega[codigo].qty + delta;
    if (delta > 0 && newQty > maxStock) {
        toast("⚠️ No hay más stock en bodega (" + maxStock + " disponible" + (maxStock !== 1 ? "s" : "") + ")");
        return;
    }
    carritoEntrega[codigo].qty = Math.max(0, newQty);
    if (carritoEntrega[codigo].qty === 0) delete carritoEntrega[codigo];
    const nuevoQty = carritoEntrega[codigo]?.qty || 0;
    const domId    = safeId(codigo);

    // Actualizar span de cantidad
    const el = document.getElementById("qty-" + domId);
    if (el) el.textContent = nuevoQty;

    // Actualizar estilo de píldora de talla
    const pill = document.getElementById("pill-" + domId);
    if (pill) {
        const isNow = nuevoQty > 0;
        pill.style.background  = isNow ? 'rgba(201,168,76,0.18)' : 'rgba(0,0,0,0.25)';
        pill.style.borderColor = isNow ? 'var(--dorado)' : 'var(--borde)';
        const label = pill.querySelector('div:first-child');
        if (label) label.style.color = isNow ? 'var(--dorado)' : 'var(--blanco)';
    }

    // Actualizar borde de la tarjeta agrupada
    const codigoBase = getCodigoBase(codigo);
    const groupCard  = document.getElementById("pc-group-" + safeId(codigoBase));
    if (groupCard) {
        const anySelected = Object.keys(carritoEntrega).some(k =>
            getCodigoBase(k) === codigoBase && (carritoEntrega[k]?.qty || 0) > 0
        );
        groupCard.classList.toggle("seleccionado", anySelected);
    }

    actualizarCarritoEntrega();
}

function actualizarCarritoEntrega() {
    const items = Object.entries(carritoEntrega).filter(([, e]) => e.qty > 0);
    // Total de piezas físicas
    const totalPiezas = items.reduce((s, [, e]) => s + e.qty, 0);
    // Valor total
    const valor = items.reduce((s, [, e]) => s + e.qty * parseFloat(e.item.precio || e.item.precioNum || 0), 0);
    document.getElementById("carrito-count").textContent = totalPiezas;
    document.getElementById("carrito-valor").textContent = "$" + valor.toFixed(2);
    document.getElementById("carrito-entrega").classList.toggle("visible", totalPiezas > 0);

    // Vista previa en vivo de lo que se ha ido escaneando/agregando
    const preview = document.getElementById("carrito-preview");
    if (preview) {
        preview.innerHTML = items.slice().reverse().map(([codigo, e]) => {
            const foto = ikFoto(e.item.foto || e.item.img, 80) || '';
            return `<div class="carrito-preview-item">
                <img src="${sanitizar(foto)}" onerror="this.style.display='none'">
                <div class="cpi-info">
                    <div class="cpi-codigo">${sanitizar(codigo)}</div>
                    <div class="cpi-nombre">${sanitizar(e.item.nombre || '')}</div>
                </div>
                <div class="cpi-qty">×${e.qty}</div>
                <button class="cpi-quitar" onclick="cambiarQtyEntrega('${codigo.replace(/'/g,"\\'")}',-${e.qty})" title="Quitar">✕</button>
            </div>`;
        }).join('');
    }
}

function vaciarCarritoEntrega() {
    if (!Object.keys(carritoEntrega).length) return;
    if (!confirm("¿Vaciar todo el carrito? Se perderá lo que llevas agregado (aún no guardado).")) return;
    carritoEntrega = {};
    actualizarCarritoEntrega();
    filtrarProductosEntrega();
}

function filtrarProductosEntrega() {
    const busq = document.getElementById("bus-entrega").value.toLowerCase();
    if (!busq) { renderGridEntrega(productosDisponibles); return; }
    const filtrados = productosDisponibles.filter(p => {
        const nombre     = (p.nombre || "").toLowerCase();
        const nombreBase = (p.nombre_base || nombre.replace(/ t\d+$/i, "")).toLowerCase();
        const codigo     = (p.codigo || "").toLowerCase();
        const codigoBas  = getCodigoBase(codigo);   // extrae código base del código
        return nombre.includes(busq) || nombreBase.includes(busq)
            || codigo.includes(busq) || codigoBas.includes(busq);
    });
    renderGridEntrega(filtrados);
}

// ── FIRMA DIGITAL ────────────────────────────────────────────────────
let _firmaActiva = false;
let _firmaCodigoActual = "";

function generarCodigoFirma() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// Guarda el avance seleccionado como borrador — SIN firma, SIN entrega física,
// SIN publicar en el link del vendedor. Solo respalda en el servidor para no
// perder el progreso si se arma la lista en varias sesiones.
async function guardarBorrador() {
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

    const btn = document.getElementById("btn-guardar-borrador");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Guardando..."; }
    try {
        const res = await apiPost({ accion: "REGISTRAR_ENTREGA", vendedor: vendedorActual.codigo, items, borrador: true });
        const guardados = new Set(res.guardados || (res.ok ? items.map(i => i.codigo) : []));
        const fallidos  = res.fallidos || [];

        // Solo quitar del carrito lo que SÍ se guardó — lo fallido se queda
        // para poder reintentarlo, en vez de perderse en silencio.
        items.filter(item => guardados.has(item.codigo)).forEach(item => {
            consignacion.push({ ...item, vendedor: vendedorActual.codigo, vendido: 0, estado: "borrador" });
            delete carritoEntrega[item.codigo];
        });

        if (fallidos.length > 0) {
            toast("⚠️ " + guardados.size + " guardados, " + fallidos.length + " FALLARON: " + fallidos.map(f => f.codigo).join(", "));
            actualizarCarritoEntrega();
        } else {
            toast("📝 " + guardados.size + " producto(s) guardados en borrador — aún no entregados ni publicados");
            volverPerfil();
        }
        renderPerfilStats();
    } catch(e) {
        toast("⚠️ Error al guardar — nada se perdió, sigue en el carrito: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "📝 Borrador (guardar, no publicar)"; }
    }
}

function abrirModalFirma() {
    const items = Object.values(carritoEntrega);
    if (!items.length) return;
    _firmaCodigoActual = generarCodigoFirma();
    document.getElementById("firma-vendedor-nombre").textContent = vendedorActual.nombre;
    document.getElementById("firma-codigo").textContent = _firmaCodigoActual;
    limpiarFirma();
    abrirModal("modal-firma");
    inicializarCanvasFirma();
    const btnConfirmar = document.getElementById("btn-confirmar-firma");
    if (btnConfirmar) btnConfirmar.setAttribute("onclick", "confirmarEntregaConFirma()");
}

function inicializarCanvasFirma() {
    const canvas = document.getElementById("firma-canvas");
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let dibujando = false;
    let ultimoX = 0, ultimoY = 0;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if (e.touches) {
            return {
                x: (e.touches[0].clientX - rect.left) * scaleX,
                y: (e.touches[0].clientY - rect.top) * scaleY
            };
        }
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function iniciar(e) {
        e.preventDefault();
        dibujando = true;
        _firmaActiva = true;
        document.getElementById("firma-placeholder").style.display = "none";
        const pos = getPos(e);
        ultimoX = pos.x; ultimoY = pos.y;
        ctx.beginPath();
        ctx.moveTo(ultimoX, ultimoY);
    }

    function dibujar(e) {
        e.preventDefault();
        if (!dibujando) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ultimoX = pos.x; ultimoY = pos.y;
    }

    function terminar(e) { e.preventDefault(); dibujando = false; }

    canvas.removeEventListener("mousedown", canvas._mousedown);
    canvas.removeEventListener("mousemove", canvas._mousemove);
    canvas.removeEventListener("mouseup", canvas._mouseup);
    canvas.removeEventListener("touchstart", canvas._touchstart);
    canvas.removeEventListener("touchmove", canvas._touchmove);
    canvas.removeEventListener("touchend", canvas._touchend);

    canvas._mousedown = iniciar; canvas._mousemove = dibujar; canvas._mouseup = terminar;
    canvas._touchstart = iniciar; canvas._touchmove = dibujar; canvas._touchend = terminar;

    canvas.addEventListener("mousedown", iniciar);
    canvas.addEventListener("mousemove", dibujar);
    canvas.addEventListener("mouseup", terminar);
    canvas.addEventListener("touchstart", iniciar, { passive: false });
    canvas.addEventListener("touchmove", dibujar, { passive: false });
    canvas.addEventListener("touchend", terminar, { passive: false });
}

function limpiarFirma() {
    const canvas = document.getElementById("firma-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _firmaActiva = false;
    document.getElementById("firma-placeholder").style.display = "block";
}

// El botón cerraba el modal de firma al instante y volvía a quedar
// clickeable mientras confirmarEntrega() seguía en curso — un doble toque
// (muy fácil en tablet) disparaba dos REGISTRAR_ENTREGA para el mismo
// carrito. Cada uno suma su propia cantidad a stock_consignacion (delta, no
// valor fijo), así que el contador terminaba duplicado aunque solo se haya
// entregado una vez físicamente — el caso real que encontró esto fue
// PUP105 con Jaime Solórzano: 1 pieza entregada, quedó registrada como 2.
let _confirmandoEntrega = false;
async function confirmarEntregaConFirma() {
    if (_confirmandoEntrega) return;
    if (!_firmaActiva) { toast("⚠️ El vendedor debe firmar primero"); return; }
    _confirmandoEntrega = true;
    const btn = document.getElementById("btn-confirmar-firma");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Confirmando..."; }
    try {
        const firmaImg = document.getElementById("firma-canvas").toDataURL("image/png");
        cerrarModal("modal-firma");
        await confirmarEntrega(firmaImg, _firmaCodigoActual);
    } finally {
        _confirmandoEntrega = false;
        if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmar y Generar Recibo"; }
    }
}

// ── Firma digital del contrato de vendedor/afiliado ──────────────────
let _vendedorPendienteFirma = null;
let _firmaContratoActiva = false;

function abrirFirmaContrato(vendedor) {
    _vendedorPendienteFirma = vendedor;
    _firmaContratoActiva = false;
    document.getElementById("firma-contrato-vendedor-nombre").textContent = vendedor.nombre;
    limpiarFirmaContrato();
    abrirModal("modal-firma-contrato");
    inicializarCanvasGenerico("firma-contrato-canvas", "firma-contrato-placeholder", () => { _firmaContratoActiva = true; });
}

function inicializarCanvasGenerico(canvasId, placeholderId, onFirstStroke) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let dibujando = false;
    let ultimoX = 0, ultimoY = 0;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if (e.touches) {
            return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
        }
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function iniciar(e) {
        e.preventDefault();
        dibujando = true;
        if (onFirstStroke) onFirstStroke();
        const ph = document.getElementById(placeholderId);
        if (ph) ph.style.display = "none";
        const pos = getPos(e);
        ultimoX = pos.x; ultimoY = pos.y;
        ctx.beginPath();
        ctx.moveTo(ultimoX, ultimoY);
    }

    function dibujar(e) {
        e.preventDefault();
        if (!dibujando) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ultimoX = pos.x; ultimoY = pos.y;
    }

    function terminar(e) { e.preventDefault(); dibujando = false; }

    canvas.removeEventListener("mousedown", canvas._mousedown);
    canvas.removeEventListener("mousemove", canvas._mousemove);
    canvas.removeEventListener("mouseup", canvas._mouseup);
    canvas.removeEventListener("touchstart", canvas._touchstart);
    canvas.removeEventListener("touchmove", canvas._touchmove);
    canvas.removeEventListener("touchend", canvas._touchend);

    canvas._mousedown = iniciar; canvas._mousemove = dibujar; canvas._mouseup = terminar;
    canvas._touchstart = iniciar; canvas._touchmove = dibujar; canvas._touchend = terminar;

    canvas.addEventListener("mousedown", iniciar);
    canvas.addEventListener("mousemove", dibujar);
    canvas.addEventListener("mouseup", terminar);
    canvas.addEventListener("touchstart", iniciar, { passive: false });
    canvas.addEventListener("touchmove", dibujar, { passive: false });
    canvas.addEventListener("touchend", terminar, { passive: false });
}

function limpiarFirmaContrato() {
    const canvas = document.getElementById("firma-contrato-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _firmaContratoActiva = false;
    document.getElementById("firma-contrato-placeholder").style.display = "block";
}

async function confirmarFirmaContrato() {
    if (!_vendedorPendienteFirma) return;
    if (!_firmaContratoActiva) { toast("⚠️ Falta la firma"); return; }
    const firmaImg = document.getElementById("firma-contrato-canvas").toDataURL("image/png");
    const v = _vendedorPendienteFirma;
    v.firmaContrato = firmaImg;
    v.firmaContratoFecha = new Date().toISOString();
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: v });
    cerrarModal("modal-firma-contrato");
    generarContratoPDF(v);
    _vendedorPendienteFirma = null;
    toast("✅ Contrato firmado digitalmente");
}

function omitirFirmaContrato() {
    if (!_vendedorPendienteFirma) { cerrarModal("modal-firma-contrato"); return; }
    const v = _vendedorPendienteFirma;
    cerrarModal("modal-firma-contrato");
    generarContratoPDF(v);
    _vendedorPendienteFirma = null;
}

// El admin marca esto cuando YA tiene en mano el papel firmado (después de
// "Firmar después (físico)"). Sin esto, un afiliado que firmó en papel
// quedaría bloqueado para generar su catálogo, igual que uno que nunca firmó.
async function marcarFirmadoFisico() {
    if (!vendedorActual) return;
    if (!confirm(`¿Confirmas que ya tienes en mano el contrato de ${vendedorActual.nombre} firmado en papel?`)) return;
    vendedorActual.firmadoFisico = true;
    vendedorActual.firmadoFisicoFecha = new Date().toISOString();
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    toast("✅ Marcado como firmado en papel");
    abrirPerfil(vendedorActual.codigo);
}

async function descargarContratoActual() {
    if (!vendedorActual) return;
    // Refrescar por si el afiliado firmó a distancia después de la última carga
    try {
        const res = await fetch(API_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ accion: "GET_CONSIGNACION", _pass: _sessionPass }) });
        const data = await res.json();
        if (data.vendedores) {
            vendedores = data.vendedores;
            const actualizado = vendedores.find(v => v.codigo === vendedorActual.codigo);
            if (actualizado) vendedorActual = actualizado;
        }
    } catch(_) {}
    generarContratoPDF(vendedorActual);
}

async function enviarLinkFirmaRemota() {
    if (!_vendedorPendienteFirma) return;
    const v = _vendedorPendienteFirma;
    const token = generarLinkId();
    await apiPost({ accion: "GUARDAR_TOKEN_FIRMA", vendedor: v.codigo, token });
    v.tokenFirma = token;
    const link = "https://verex-nexus.pages.dev/firmar.html?v=" + encodeURIComponent(v.codigo) + "&token=" + encodeURIComponent(token);
    const tel = String(v.telefono || "").replace(/\D/g, "");
    const msg = "Hola " + v.nombre + "! Para completar tu registro con VEREX, por favor firma tu contrato aquí:\n" + link;
    cerrarModal("modal-firma-contrato");
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
    toast("📱 Link de firma enviado — el contrato se generará automáticamente cuando firme");
    _vendedorPendienteFirma = null;
}

// Genera (o reusa) el token del portal de pedidos del afiliado y comparte el
// link por WhatsApp — ahí completa nombre/teléfono/dirección de sus ventas
// cerradas antes de que VEREX las confirme.
// El link del catálogo de cada afiliado sigue siempre el mismo patrón fijo,
// basado en su nombre (igual que generarIdAfiliado() en Admin) — así que se
// puede reconstruir aquí sin necesidad de guardar/consultar nada extra.
// Catálogo ACTUAL del vendedor en su link fijo (/c/<nombre>): lo arma en ese momento con
// lo que tiene en consignación («✓ DISPONIBLE YA») + su selección de afiliado si la tiene
// («📦 BAJO PEDIDO») — admin-tienda/functions/seller-catalog.js. Así el link nunca queda
// vencido ni desactualizado. Si falla, abre el link tal cual (comportamiento anterior).
async function verCatalogoActualAfiliado() {
    if (!vendedorActual) return;
    const slug = (vendedorActual.nombre || "")
        .toLowerCase()
        .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
        .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u').replace(/ñ/g,'n')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if (!slug) return toast("⚠️ No se pudo generar el link — falta el nombre del vendedor");
    const link = "https://admin-tienda.pages.dev/c/" + slug;
    // La ventana se abre YA (si se abre después de esperar, el navegador la bloquea).
    const win = window.open("", "_blank");
    if (win) win.document.write('<p style="font-family:sans-serif;text-align:center;padding:3rem;color:#888">⏳ Actualizando el catálogo…</p>');
    toast("⏳ Actualizando catálogo con su inventario actual…");
    try {
        const res = await fetch("https://admin-tienda.pages.dev/seller-catalog", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                _pass: _sessionPass, slug,
                vendedor: { codigo: vendedorActual.codigo, nombre: vendedorActual.nombre, telefono: vendedorActual.telefono || "" },
            }),
        });
        const out = await res.json().catch(() => ({}));
        if (out.ok) {
            toast("✅ Catálogo al día: " + out.enMano + " disponibles ya · " + out.bajoPedido + " bajo pedido");
        } else if (out.error === "sin_productos") {
            if (win) win.close();
            return toast("⚠️ " + vendedorActual.nombre + " no tiene piezas en consignación ni catálogo de afiliado");
        } else {
            toast("⚠️ No se pudo actualizar el catálogo — se abre el último guardado");
        }
    } catch (e) {
        toast("⚠️ Sin conexión para actualizar — se abre el último guardado");
    }
    if (win) win.location.href = link; else window.open(link, "_blank");
}

async function enviarLinkPedidos() {
    if (!vendedorActual) return;
    let token = vendedorActual.tokenPedidos;
    if (!token) {
        token = generarLinkId();
        await apiPost({ accion: "GUARDAR_TOKEN_PEDIDOS", vendedor: vendedorActual.codigo, token });
        vendedorActual.tokenPedidos = token;
    }
    const link = "https://verex-nexus.pages.dev/pedido.html?v=" + encodeURIComponent(vendedorActual.codigo) + "&token=" + encodeURIComponent(token);
    const tel = String(vendedorActual.telefono || "").replace(/\D/g, "");
    const msg = "Hola " + vendedorActual.nombre + "! Aquí completas los datos (nombre, teléfono y dirección) de tus pedidos cerrados, para que VEREX pueda confirmarlos:\n" + link;
    try { await navigator.clipboard.writeText(link); } catch(_){}
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
    toast("🔗 Link copiado y enviado por WhatsApp");
}

async function confirmarEntrega(firmaImg, codigoFirma) {
    firmaImg = firmaImg || null;
    codigoFirma = codigoFirma || "";
    const items = Object.values(carritoEntrega).map(e => ({
        id:          Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        codigo:      e.item.codigo,                                // "AN021T10"
        codigoBase:  e.item.codigoBase || getCodigoBase(e.item.codigo), // "AN021"
        talla:       e.item.talla || getTallaFromCodigo(e.item.codigo) || "",
        nombre:      e.item.nombre,
        nombre_base: e.item.nombre_base || (e.item.nombre || "").replace(/ T\d+$/i, "").trim(),
        categoria:   e.item.categoria || getCodigoBase(e.item.codigo).match(/^[A-Z]+/)?.[0] || "GEN",
        precio:      e.item.precio || e.item.precioNum || 0,
        cantidad:    e.qty,
        foto:        e.item.foto || e.item.img || ""
    }));
    if (!items.length) return;

    // Registrar en el backend — si falla, continuar de todas formas para generar el PDF
    // (el vendedor ya firmó físicamente), pero avisar si algún item no se guardó.
    let fallidosEntrega = [];
    try {
        const resEnt = await apiPost({ accion: "REGISTRAR_ENTREGA", vendedor: vendedorActual.codigo, items });
        fallidosEntrega = resEnt.fallidos || [];
    } catch(e) { console.warn("REGISTRAR_ENTREGA error:", e); fallidosEntrega = items.map(i => ({codigo: i.codigo})); }

    items.forEach(item => consignacion.push({ ...item, vendedor: vendedorActual.codigo, vendido: 0, estado: "activo" }));

    const entregaId = "ENT_" + Date.now();
    try {
        await apiPost({
            accion: "REGISTRAR_ENTREGA_PENDIENTE",
            id: entregaId,
            vendedor: vendedorActual.codigo,
            items,
            codigoRecibo: codigoFirma || generarCodigoFirma()
        });
    } catch(e) { console.warn("REGISTRAR_ENTREGA_PENDIENTE error:", e); }

    // Guardar copia del vendedor actual antes de volver al perfil
    const vendedorParaPDF = { ...vendedorActual };

    if (fallidosEntrega.length > 0) {
        toast("⚠️ OJO: " + fallidosEntrega.length + " producto(s) NO se guardaron en el sistema: " + fallidosEntrega.map(f => f.codigo).join(", "));
    } else {
        toast("✅ Entrega registrada — generando recibo...");
    }
    volverPerfil();
    renderPerfilStats();
    renderInventario();
    setTimeout(() => {
        try {
            generarReciboPDF(vendedorParaPDF, items, firmaImg, codigoFirma);
        } catch(e) {
            console.error("Error generando recibo PDF:", e);
            toast("⚠️ Error al generar PDF: " + e.message);
        }
    }, 400);
}

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
