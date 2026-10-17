// Hub VEREX — Ver/editar producto y ocasiones (15 años, compromiso…)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
function verProducto(key) {
    const p = mapaProductos[key];
    if (!p) return;
    productoEditando = { key, p };
    document.getElementById("modal-prod-titulo").textContent = p.codigo || "Producto";
    const foto = document.getElementById("modal-prod-foto");
    if (p.img) { foto.src = ikFoto(p.img, 900); foto.style.display = "block"; }
    else { foto.style.display = "none"; }
    document.getElementById("vp-codigo").textContent = p.codigo || "";
    document.getElementById("vp-nombre").textContent = p.nombre || "";
    document.getElementById("vp-desc").textContent = p.descripcion || "";
    document.getElementById("vp-precio").textContent = "$" + parseFloat(p.precio || p.precioNum || 0).toFixed(2);
    document.getElementById("modal-prod-vista").style.display = "block";
    document.getElementById("modal-prod-edicion").style.display = "none";
    abrirModal("modal-ver-producto");
}

function activarEdicionProducto() {
    if (!productoEditando) return;
    const p = productoEditando.p;
    document.getElementById("ep-codigo").value = p.codigo || "";
    document.getElementById("ep-nombre").value = p.nombre || "";
    document.getElementById("ep-desc").value = p.descripcion || "";
    document.getElementById("ep-precio").value = p.precio || p.precioNum || "";
    document.getElementById("ep-existencia").value = 0;
    document.getElementById("ep-caract").value = p.caracterEspecial || "";
    const chkNoWA = document.getElementById("ep-no-wa");
    if (chkNoWA) chkNoWA.checked = p.noOfrecerWhatsApp === true;
    iniciarOcasionesEP(p.codigo);
    // Marcar material actual
    document.querySelectorAll(".ep-mat-btn").forEach(b => {
        b.style.outline = (b.dataset.mat === p.material) ? "2px solid var(--dorado)" : "";
    });
    // Marcar set_config actual y mostrar campos de precio correctos
    const scActual = p.set_config || "";
    document.querySelectorAll(".ep-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; });
    const epSetBtn = document.querySelector(`.ep-set-btn[data-set="${scActual}"]`);
    if (epSetBtn) { epSetBtn.style.background="var(--dorado)"; epSetBtn.style.color="#111"; epSetBtn.style.borderColor="var(--dorado)"; }
    const esSetActual = scActual !== "";
    document.getElementById("ep-precio").style.display = esSetActual ? "none" : "";
    document.getElementById("ep-precio-set-wrap").style.display = esSetActual ? "flex" : "none";
    if (esSetActual) {
        const pDama = parseFloat(p.precio || p.precioNum) || 0;
        const pCab  = parseFloat(p.precio_caballero) || 0;
        const esUniActual = !pCab || pCab === pDama;
        selPrecioTipoEP(esUniActual ? 'unisex' : 'dif');
        if (esUniActual) {
            document.getElementById("ep-precio-unisex").value = pDama || "";
        } else {
            document.getElementById("ep-precio-dama").value = pDama || "";
            document.getElementById("ep-precio-caballero").value = pCab || "";
        }
    }
    // El campo de talla y el "Tipo de venta" (par/trío) solo aplican a
    // anillos y conjuntos — antes ocultaban por error también la "Cantidad
    // a sumar" (compartían el mismo div contenedor vía .closest("div")).
    const esAnilloEP = p.categoria === "AN" || p.categoria === "CJ";
    const tallaHint = document.getElementById("ep-talla-hint");
    if (tallaHint) tallaHint.style.display = esAnilloEP ? "block" : "none";

    const setAnilloWrap = document.getElementById("ep-set-anillo-wrap");
    if (setAnilloWrap) setAnilloWrap.style.display = esAnilloEP ? "block" : "none";
    document.getElementById("modal-prod-vista").style.display = "none";
    document.getElementById("modal-prod-edicion").style.display = "block";
    // Mostrar foto actual en el preview del editor
    const fotoActual = productoEditando.p.img || productoEditando.p.foto || "";
    const prev = document.getElementById("ep-foto-preview");
    if (fotoActual) {
        prev.innerHTML = `<img src="${fotoActual}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
    } else {
        prev.innerHTML = "📷";
    }

    // foto change listener
    document.getElementById("ep-foto").onchange = async function() {
        const file = this.files[0]; if (!file) return;
        const r = await procesarFotoJoya(file);
        productoEditando.nuevaFotoFile = file;
        productoEditando.nuevaFotoOriginal = r.original;
        productoEditando.nuevaFotoCrop = r.crop;
        productoEditando.nuevaFoto = r.preview;
        prev.innerHTML = `<img src="${r.preview}" style="width:100%;height:100%;object-fit:contain;border-radius:10px;">`;
    };
}

// ── Ocasiones (15 años, compromiso, caballero…) ──────────────────────
// Etiquetas internas para armar Catálogos de Cliente en el admin; el cliente
// no las ve. Se guardan con STOCK_OCASIONES, que las aplica a TODAS las tallas
// del diseño. La lista se edita en el admin (⚙️ Ocasiones → config.ocasiones);
// esta es la lista inicial por si nunca se ha guardado (igual a la del admin).
const OCASIONES_DEFAULT_HUB = [
    { id: "15anos",       emoji: "👑", nombre: "15 años" },
    { id: "compromiso",   emoji: "💍", nombre: "Compromiso" },
    { id: "matrimonio",   emoji: "💑", nombre: "Matrimonio" },
    { id: "caballero",    emoji: "🧔", nombre: "Caballero" },
    { id: "graduacion",   emoji: "🎓", nombre: "Graduación" },
    { id: "dia-madre",    emoji: "🎁", nombre: "Día de la Madre" },
    { id: "san-valentin", emoji: "❤️", nombre: "San Valentín" },
    { id: "religioso",    emoji: "✝️", nombre: "Bautizo / Primera Comunión" },
    { id: "navidad",      emoji: "🎄", nombre: "Navidad" },
    { id: "bebe",         emoji: "👶", nombre: "Bebé / niña" },
];
let _ocasionesHub = null;
let _epOcasiones = new Set();
let _epOcasionesOrig = [];
let _snOcasiones = new Set();   // formulario Stock → Nuevo producto

// Vuelve a leer la lista por si se editó en el admin; mientras tanto se usa la última conocida.
function _refrescarListaOcasiones(alTerminar) {
    apiPost({ accion: "GET_CONFIG" }).then(r => {
        const l = r && r.config && r.config.ocasiones;
        if (Array.isArray(l) && l.length) { _ocasionesHub = l; alTerminar(); }
    }).catch(() => {});
}

// Chips de ocasión; `fn` es el nombre de la función global que alterna una ocasión.
// Una ocasión oculta solo se muestra si ya está marcada (para poder quitarla).
function _chipsOcasionesHTML(seleccion, fn) {
    const lista = _ocasionesHub || OCASIONES_DEFAULT_HUB;
    return lista.filter(o => !o.oculta || seleccion.has(o.id)).map(o => {
        const on = seleccion.has(o.id);
        return `<button type="button" data-id="${o.id}" onclick="${fn}(this.dataset.id)"
            style="padding:5px 10px;border:1px solid ${on ? "var(--dorado)" : "var(--borde)"};border-radius:14px;background:${on ? "var(--dorado)" : "var(--gris2)"};color:${on ? "#111" : "var(--blanco)"};font-size:11px;font-weight:700;cursor:pointer;">${o.emoji || ""} ${String(o.nombre || o.id).replace(/</g, "&lt;")}</button>`;
    }).join("");
}

function iniciarOcasionesSN() {
    _snOcasiones = new Set();
    renderOcasionesSN();
    _refrescarListaOcasiones(renderOcasionesSN);
}

function renderOcasionesSN() {
    const cont = document.getElementById("sn-ocasiones");
    if (cont) cont.innerHTML = _chipsOcasionesHTML(_snOcasiones, "toggleOcasionSN");
}

function toggleOcasionSN(id) {
    if (_snOcasiones.has(id)) _snOcasiones.delete(id); else _snOcasiones.add(id);
    renderOcasionesSN();
}

// Ocasiones que ya tiene el diseño (unión de todas sus tallas activas).
function _ocasionesDelDiseno(codigo) {
    const base = getCodigoBase(codigo);
    const s = new Set();
    (stockData || []).filter(x => x.estado !== "inactivo" && (x.codigo === codigo || getCodigoBase(x.codigo) === base))
        .forEach(x => (Array.isArray(x.ocasiones) ? x.ocasiones : []).forEach(o => s.add(o)));
    return [...s];
}

function iniciarOcasionesEP(codigo) {
    _epOcasionesOrig = _ocasionesDelDiseno(codigo);
    _epOcasiones = new Set(_epOcasionesOrig);
    renderOcasionesEP();
    _refrescarListaOcasiones(renderOcasionesEP);
}

function renderOcasionesEP() {
    const cont = document.getElementById("ep-ocasiones");
    if (cont) cont.innerHTML = _chipsOcasionesHTML(_epOcasiones, "toggleOcasionEP");
}

function toggleOcasionEP(id) {
    if (_epOcasiones.has(id)) _epOcasiones.delete(id); else _epOcasiones.add(id);
    renderOcasionesEP();
}

// Guarda las ocasiones si cambiaron. Devuelve false si el servidor no las guardó.
async function guardarOcasionesEP(codigo) {
    const nuevas = [..._epOcasiones];
    const igual = nuevas.length === _epOcasionesOrig.length && nuevas.every(o => _epOcasionesOrig.includes(o));
    if (igual) return true;
    try {
        const r = await apiPost({ accion: "STOCK_OCASIONES", codigos: [codigo], ocasiones: nuevas });
        if (!r || !r.ok) throw new Error((r && r.error) || "sin respuesta");
        (r.actualizados || []).forEach(a => { const x = stockData.find(s => s.codigo === a.codigo); if (x) x.ocasiones = a.ocasiones; });
        _epOcasionesOrig = nuevas;
        return true;
    } catch (e) {
        console.error("[ocasiones]", e);
        return false;
    }
}

function cancelarEdicionProducto() {
    document.getElementById("modal-prod-vista").style.display = "block";
    document.getElementById("modal-prod-edicion").style.display = "none";
    productoEditando.nuevaFoto = null;
}

// Registra la 2da pieza de dama de un trío (ej. anillo de compromiso, aparte
// del de matrimonio) sin tocar las filas que ya existen de dama/caballero.
// Reusa nombre_base/categoria/material/foto del producto que está abierto,
// y crea el código con el sufijo "B" que el catálogo ya sabe reconocer como
// una pieza distinta.
async function agregarSegundaPiezaDamaTrio() {
    if (!productoEditando) return;
    const p = productoEditando.p;
    const codigoBase = p.codigoBase || getCodigoBase(p.codigo);
    if (!codigoBase) { toast("⚠️ No se pudo determinar el código base de este producto"); return; }

    const tallasRaw = prompt("Tallas de la 2da pieza de dama, separadas por coma.\nSi hay más de 1 unidad de una talla, pon talla:cantidad (ej: 6,7:2,9:2):");
    if (!tallasRaw) return;
    const entradas = tallasRaw.split(",").map(t => t.trim()).filter(Boolean).map(t => {
        const [talla, cantRaw] = t.split(":").map(x => x.trim());
        const cantidad = parseInt(cantRaw, 10);
        return { talla, cantidad: (!cantRaw || isNaN(cantidad) || cantidad < 1) ? 1 : cantidad };
    });
    if (!entradas.length) return toast("⚠️ No ingresaste ninguna talla");

    const precioRaw = prompt("Precio de esta 2da pieza de dama ($):");
    if (!precioRaw) return;
    const precio = parseFloat(precioRaw);
    if (isNaN(precio) || precio < 0) return toast("⚠️ Precio inválido");

    const codigoBase2 = codigoBase + "B";
    const nombreBase  = p.nombre_base || (p.nombre || "").replace(/\s+(Dama|Caballero)?\s*T?\d+(\.\d+)?$/i, "").trim();
    let guardados = 0;
    for (const { talla, cantidad } of entradas) {
        const codigo = codigoBase2 + "DT" + talla;
        const res = await apiPost({
            accion: "STOCK_REGISTRAR",
            codigo, codigoBase: codigoBase2, talla,
            nombre: `${nombreBase} Dama T${talla}`,
            nombre_base: nombreBase,
            categoria: p.categoria || "AN",
            precio, foto: p.img || p.foto || "", cantidad,
            material: p.material || "",
            descripcion: p.descripcion || "",
            caracterEspecial: p.caracterEspecial || ""
        });
        if (res.ok) guardados++;
    }
    toast(`✅ ${guardados} talla${guardados > 1 ? "s" : ""} de la 2da pieza registrada${guardados > 1 ? "s" : ""} — ya forma un trío`);
    cerrarModal("modal-ver-producto");
    await cargarStock();
}

async function guardarEdicionProducto() {
    if (!productoEditando) return;
    const btn = document.querySelector("#modal-prod-edicion .btn-dorado");
    btn.textContent = "⏳ Guardando..."; btn.disabled = true;
    const codigo  = document.getElementById("ep-codigo").value.trim();
    const nombre  = document.getElementById("ep-nombre").value.trim();
    const desc    = document.getElementById("ep-desc").value.trim();
    const setConfigEP  = document.querySelector(".ep-set-btn[style*='var(--dorado)']")?.dataset.set ?? "";
    const esSetEP      = setConfigEP !== "";
    const esUnisexEP   = esSetEP && document.getElementById("ep-precio-unisex-wrap")?.style.display !== "none";
    const precio       = esSetEP
        ? (esUnisexEP ? (parseFloat(document.getElementById("ep-precio-unisex").value) || 0)
                      : (parseFloat(document.getElementById("ep-precio-dama").value) || 0))
        : (parseFloat(document.getElementById("ep-precio").value) || 0);
    const precioCaballeroEP = esSetEP
        ? (esUnisexEP ? precio : (parseFloat(document.getElementById("ep-precio-caballero").value) || 0))
        : undefined;
    if (!nombre || !precio) { toast("⚠️ Completa nombre y precio"); btn.textContent = "💾 Guardar"; btn.disabled = false; return; }
    if (esSetEP && !esUnisexEP && !precioCaballeroEP) { toast("⚠️ Completa el precio de caballero"); btn.textContent = "💾 Guardar"; btn.disabled = false; return; }
    let img = productoEditando.p.img || "";
    // Si se CAMBIA la foto, la versión "mejorada" guardada es de la foto anterior: hay que borrarla, porque la pantalla
    // muestra fotoMejorada antes que foto y seguiría enseñando la foto vieja (el cambio parecía no aplicarse).
    const cambioFoto = !!productoEditando.nuevaFoto;
    if (cambioFoto) {
        const url = await subirFotoImageKit(productoEditando.nuevaFotoFile || productoEditando.nuevaFotoOriginal || productoEditando.nuevaFoto, codigo, productoEditando.nuevaFotoCrop);
        if (!url) {
            // Sin URL no se guarda nada de la foto (antes se guardaba la imagen completa en base64 como si fuera la URL).
            toast("⚠️ No se pudo subir la foto nueva — no se cambió la foto. Inténtalo de nuevo.", "#ef4444");
            btn.textContent = "💾 Guardar"; btn.disabled = false;
            return;
        }
        img = url;
    }
    const limpiaMejora = cambioFoto ? { fotoMejorada: "", fotoMejoraNivel: "" } : {};
    const matSelBtn = document.querySelector(".ep-mat-btn[style*='solid var(--dorado)']");
    const material  = matSelBtn ? matSelBtn.dataset.mat : (productoEditando.p.material || "");
    const caracterEspecial = (document.getElementById("ep-caract")?.value || "").trim();
    const codigoViejo = productoEditando.p.codigo;
    const noOfrecerWhatsApp = !!document.getElementById("ep-no-wa")?.checked;
    // nombre_base es el nombre "limpio" sin el sufijo de talla (ej. "Pulsera
    // Étoile Blanc T7" -> "Pulsera Étoile Blanc") — es lo que muestran Stock
    // y el catálogo, así que hay que mantenerlo sincronizado con el nombre.
    const nombreBaseEP = nombre.replace(/\s+T?\d+(\.\d+)?\s*$/i, "").trim() || nombre;
    // Update en servidor
    await apiPost({ accion: "EDITAR_PRODUCTO", codigo: codigoViejo, nuevo_codigo: codigo !== codigoViejo ? codigo : undefined, nombre, nombre_base: nombreBaseEP, descripcion: desc, precio, img, material, caracterEspecial, set_config: setConfigEP || undefined, precio_caballero: precioCaballeroEP, noOfrecerWhatsApp, ...limpiaMejora });
    productoEditando.p.noOfrecerWhatsApp = noOfrecerWhatsApp;
    const itemEditado = stockData.find(s => s.codigo === codigoViejo);
    if (itemEditado) itemEditado.noOfrecerWhatsApp = noOfrecerWhatsApp;
    // Propagar nombre_base, foto, material, descripción y caracterEspecial al
    // resto de tallas del mismo diseño — así editar cualquier talla actualiza
    // todo el grupo sin tener que hacerlo una por una.
    // «Hermanos» = todo lo que la pestaña Stock agrupa en la misma tarjeta (incluida la 2da pieza de dama «B» de un trío,
    // que tiene otro codigoBase): si no se actualiza también esa, la tarjeta sigue mostrando su foto/«mejorada» vieja.
    const claveGrupoActual = claveGrupoStock(productoEditando.p);
    const hermanos = stockData.filter(s => claveGrupoStock(s) === claveGrupoActual && s.codigo !== codigoViejo && s.estado !== "inactivo");
    for (const h of hermanos) {
        const tallaH = getTallaFromCodigo(h.codigo);
        const nombreH = tallaH ? `${nombreBaseEP} T${tallaH}` : nombreBaseEP;
        await apiPost({ accion: "EDITAR_PRODUCTO", codigo: h.codigo, nombre: nombreH, nombre_base: nombreBaseEP, descripcion: desc, img, material, caracterEspecial, noOfrecerWhatsApp, ...limpiaMejora });
        // h es la misma referencia que el objeto dentro de stockData — reflejar
        // el cambio ahí también para que sus tarjetas se vean actualizadas sin
        // esperar a un cargarStock().
        h.nombre = nombreH; h.nombre_base = nombreBaseEP; h.descripcion = desc;
        h.img = img; h.foto = img; h.material = material; h.caracterEspecial = caracterEspecial; h.noOfrecerWhatsApp = noOfrecerWhatsApp;
        if (cambioFoto) { h.fotoMejorada = ""; h.fotoMejoraNivel = ""; }
    }
    const ocasionesOk = await guardarOcasionesEP(codigo);
    // Sumar existencia a bodega si se ingresó cantidad
    const existencia = parseInt(document.getElementById("ep-existencia")?.value) || 0;
    if (existencia > 0) {
        // Si el servidor no confirma, se avisa y el formulario queda abierto (antes decía «✅» aunque no se guardara)
        const fallo = (r, que) => {
            if (r && r.ok) return false;
            toast(`❌ ${que} NO se guardó: ${(r && r.error) || "sin respuesta del servidor"}`, "#ef4444", 8000);
            btn.textContent = "💾 Guardar"; btn.disabled = false;
            return true;
        };
        const stockActual  = stockData.find(s => s.codigo === codigoViejo);
        const bodegaActual = parseInt(stockActual?.stock_bodega || 0);
        const r = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: [{ codigo, stock_bodega: bodegaActual + existencia }] });
        if (fallo(r, "La cantidad")) return;
        toast(`✅ Producto actualizado y +${existencia} unidades sumadas a bodega`);
    } else if (ocasionesOk) {
        toast("✅ Producto actualizado");
    }
    if (!ocasionesOk) toast("⚠️ El producto se guardó, pero las ocasiones NO — revisa que el Worker esté actualizado", "#f97316", 8000);
    // Update local — usar codigoViejo para encontrar el índice antes de sobreescribir
    const p = productoEditando.p;
    const idx = productosDisponibles.findIndex(x => x.codigo === codigoViejo);
    p.codigo = codigo; p.nombre = nombre; p.nombre_base = nombreBaseEP; p.descripcion = desc;
    p.precio = precio; p.precioNum = precio; p.img = img; p.foto = img; p.material = material; p.caracterEspecial = caracterEspecial;
    if (cambioFoto) { p.fotoMejorada = ""; p.fotoMejoraNivel = ""; productoEditando.nuevaFoto = null; }
    if (idx >= 0) productosDisponibles[idx] = p;
    // productoEditando.p es una COPIA (no la misma referencia que stockData),
    // así que hay que reflejar el cambio ahí también — si no, la pestaña de
    // Stock se ve "sin cambios" hasta salir y volver a entrar.
    const stockIdx = stockData.findIndex(x => x.codigo === codigoViejo);
    if (stockIdx >= 0) Object.assign(stockData[stockIdx], p);
    btn.textContent = "💾 Guardar"; btn.disabled = false;
    cerrarModal("modal-ver-producto");
    renderGridEntrega(productosDisponibles);
    renderGridEtiquetas(productosDisponibles);
    filtrarStock();
    if (existencia > 0) {
        await cargarStock();
        await refrescarProductosEtiquetas();
    }
}
