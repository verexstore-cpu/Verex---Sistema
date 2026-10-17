// Admin VEREX — Asistente del catálogo (Cliente → Productos → Enviar), plantillas
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  ASISTENTE DEL CATÁLOGO (Cliente → Productos → Enviar)
// ═════════════════════════════════════════════
// Solo cambia la PRESENTACIÓN del modal: todos los campos que leen
// generarLinkCatalogo / PDF / Imagen / recetas siguen siendo los mismos
// (cat-validez, cat-tipo-an, cat-genero, checkboxes .cat-*-chk, etc.).
// Las tarjetas escriben en esos campos y se repintan desde ellos.
let _wzPaso = 1;
let _catPrecio = { min: 0, max: 0 };          // 0 = sin límite
const WZ_PRECIOS = [
    { id: "a", nombre: "Hasta $20",  min: 0,  max: 20 },
    { id: "b", nombre: "$20 – $35",  min: 20, max: 35 },
    { id: "c", nombre: "Más de $35", min: 35, max: 0 },
];
const WZ_TIPOS   = [["", "Todos"], ["sencillo", "Sencillos"], ["pareja", "Argollas / Pareja"]];
const WZ_GENEROS = [["", "Todos"], ["dama", "Dama"], ["caballero", "Caballero"]];
const WZ_VIGENCIAS = [["1", "1 día"], ["3", "3 días"], ["7", "7 días"], ["15", "15 días"], ["30", "30 días"]];

function _wzCoincideOcasion(p) {
    const ocs = ocasionesSeleccionadas();
    return !ocs.length || _ocasionesDeFila(p).some(o => ocs.includes(o));
}

// Diseños (no filas por talla) con stock en bodega, agrupados por la clave que
// devuelva `clave(p)` (texto o lista). Para los números de las tarjetas.
function _wzConteoDisenos(filtro, clave) {
    const conteo = {}, vistos = new Set();
    productos.forEach(p => {
        if (p.reservado || p.estado === "inactivo" || _stockBodegaProd(p) <= 0 || !filtro(p)) return;
        const base = _baseDiseno(p);
        [].concat(clave(p) || []).forEach(k => {
            if (vistos.has(k + "|" + base)) return;
            vistos.add(k + "|" + base);
            conteo[k] = (conteo[k] || 0) + 1;
        });
    });
    return conteo;
}

function _wzElegidas() { return document.querySelectorAll("#cat-lista .cat-chk:checked").length; }
function _wzEl(id) { return document.getElementById(id); }

function wzIr(n) {
    if (n < 1 || n > 3) return;
    if (n === 3 && !_wzElegidas()) { toast("⚠️ Elige al menos una pieza en el paso 2", "#f97316"); n = 2; }
    _wzPaso = n;
    [1, 2, 3].forEach(i => {
        _wzEl("wz-p-" + i).hidden = i !== n;
        const st = _wzEl("wz-st-" + i);
        st.classList.toggle("on", i === n);
        st.classList.toggle("done", i < n);
    });
    if (n === 3) wzPintarPaso3();
    wzActualizarBarra();
    const caja = document.querySelector("#modal-catalogo .mb");
    if (caja) caja.scrollTop = 0;
}

function wzActualizarBarra() {
    const info = _wzEl("wz-bar-info"), sig = _wzEl("wz-sig");
    if (!info) return;
    const total = _catFiltrada.length, sel = _wzElegidas();
    _wzEl("wz-atras").hidden = _wzPaso === 1;
    sig.hidden = _wzPaso === 3;
    sig.disabled = false;
    if (_wzPaso === 1) {
        info.innerHTML = `<b>${total}</b> pieza${total === 1 ? "" : "s"} coinciden`;
        sig.textContent = "Siguiente: elegir productos →";
    } else if (_wzPaso === 2) {
        info.innerHTML = `<b>${sel}</b> elegida${sel === 1 ? "" : "s"} de ${total}`;
        sig.textContent = "Siguiente: enviar →";
        sig.disabled = !sel;
    } else {
        const dias = _wzEl("cat-validez").value;
        info.innerHTML = `<b>${sel}</b> pieza${sel === 1 ? "" : "s"} · activo ${dias} día${dias === "1" ? "" : "s"}${_wzEl("cat-es-us")?.checked ? " · 🇺🇸 EE. UU." : ""}`;
        _wzPreview();
    }
    if (_wzEl("cat-es-us")?.checked) _wzEl("wz-us-wrap").open = true;
}

// Repinta todo lo que depende de los filtros: tarjetas de tipo/género/precio,
// la línea de filtros activos y la barra de abajo.
function _wzTrasFiltrar() {
    if (!_wzEl("wz-activos")) return;
    const tarjetasValor = (contId, opciones, actual, fn) => {
        _wzEl(contId).innerHTML = opciones.map(([v, t]) =>
            `<button type="button" class="wz-card${actual === v ? " on" : ""}" onclick="${fn}('${v}')"><span class="nm">${t}</span></button>`).join("");
    };
    tarjetasValor("wz-tipo", WZ_TIPOS, _wzEl("cat-tipo-an").value, "wzTipo");
    tarjetasValor("wz-genero", WZ_GENEROS, _wzEl("cat-genero").value, "wzGenero");
    _wzEl("wz-precio").innerHTML = WZ_PRECIOS.map(r =>
        `<button type="button" class="wz-card${_catPrecio.min === r.min && _catPrecio.max === r.max ? " on" : ""}" onclick="wzPrecio('${r.id}')"><span class="nm">${r.nombre}</span></button>`).join("");

    const tags = [];
    const tag = (txt, quitar) => tags.push(`<span class="wz-tag">${esc(txt)}<button type="button" aria-label="Quitar ${esc(txt)}" onclick="${quitar}">✕</button></span>`);
    ocasionesSeleccionadas().forEach(id => { const o = ocasionesLista(true).find(x => x.id === id); tag(`${o?.emoji || ""} ${o?.nombre || id}`.trim(), `wzQuitar('oc','${id}')`); });
    document.querySelectorAll(".cat-cat-chk:checked").forEach(c => tag(CAT_MAP[c.value] || c.value, `wzQuitar('cat','${c.value}')`));
    document.querySelectorAll(".cat-material-chk:checked").forEach(c => tag(c.closest("label").textContent.trim(), `wzQuitar('mat','${c.value}')`));
    (_wzEl("cat-talla").value || "").split(",").filter(Boolean).forEach(t => tag("T" + t, `wzQuitar('talla','${t}')`));
    if (_wzEl("cat-tipo-an").value) tag(WZ_TIPOS.find(x => x[0] === _wzEl("cat-tipo-an").value)[1], "wzTipo('')");
    if (_wzEl("cat-genero").value) tag(WZ_GENEROS.find(x => x[0] === _wzEl("cat-genero").value)[1], "wzGenero('')");
    if (_catPrecio.min || _catPrecio.max) tag(_wzTextoPrecio(_catPrecio), "wzQuitar('precio')");
    const q = (_wzEl("cat-buscar")?.value || "").trim();
    if (q) tag(`"${q}"`, "wzQuitar('buscar')");
    const pfx = (_wzEl("cat-prefijo-txt")?.value || "").trim();
    if (pfx) tag("Prefijo " + pfx.toUpperCase(), "wzQuitar('prefijo')");
    _wzEl("wz-activos").innerHTML = tags.join("") || `<span style="color:#888;font-size:12.5px;">Sin filtros: se muestra todo lo que hay en bodega</span>`;

    const nAfinar = (_catPrecio.min || _catPrecio.max ? 1 : 0) + document.querySelectorAll(".cat-material-chk:checked").length
        + (_wzEl("cat-talla").value ? 1 : 0) + (_wzEl("cat-tipo-an").value ? 1 : 0) + (_wzEl("cat-genero").value ? 1 : 0) + (pfx ? 1 : 0);
    _wzEl("wz-afinar-hint").textContent = nAfinar ? `${nAfinar} filtro${nAfinar > 1 ? "s" : ""} activo${nAfinar > 1 ? "s" : ""}` : "precio, material, talla";
    wzActualizarBarra();
}

function _wzTextoPrecio(r) {
    if (r.min && r.max) return `$${r.min} – $${r.max}`;
    if (r.max) return `Hasta $${r.max}`;
    return `Más de $${r.min}`;
}

function wzTipo(v)   { _wzEl("cat-tipo-an").value = v; filtrarParaCatalogo(); }
function wzGenero(v) { _wzEl("cat-genero").value = v; filtrarParaCatalogo(); }
function wzPrecio(id) {
    const r = WZ_PRECIOS.find(x => x.id === id);
    const igual = _catPrecio.min === r.min && _catPrecio.max === r.max;
    _catPrecio = igual ? { min: 0, max: 0 } : { min: r.min, max: r.max };
    filtrarParaCatalogo();
}

function wzQuitar(tipo, val) {
    const desmarcar = sel => document.querySelectorAll(sel).forEach(c => { if (c.value === val) c.checked = false; });
    if (tipo === "oc")      { desmarcar(".cat-ocasion-chk"); onOcasionPillChange(); return; }
    if (tipo === "cat")     { desmarcar(".cat-cat-chk"); onPillChange(); return; }
    if (tipo === "mat")     desmarcar(".cat-material-chk");
    if (tipo === "talla")   { _wzEl("cat-talla").value = _wzEl("cat-talla").value.split(",").filter(t => t && t !== val).join(","); sincronizarChipsCatTalla(); }
    if (tipo === "precio")  _catPrecio = { min: 0, max: 0 };
    if (tipo === "buscar")  _wzEl("cat-buscar").value = "";
    if (tipo === "prefijo") _wzEl("cat-prefijo-txt").value = "";
    filtrarParaCatalogo();
}

// Deja todos los filtros en blanco (lo usan la IA y las plantillas antes de aplicar los suyos).
function _wzLimpiarFiltros() {
    document.querySelectorAll(".cat-cat-chk, .cat-material-chk, .cat-ocasion-chk").forEach(c => c.checked = false);
    _wzEl("cat-talla").value = ""; sincronizarChipsCatTalla();
    _wzEl("cat-tipo-an").value = ""; _wzEl("cat-genero").value = "";
    _wzEl("cat-buscar").value = ""; _wzEl("cat-prefijo-txt").value = "";
    _catPrecio = { min: 0, max: 0 };
}

// Aplica un conjunto de filtros (de la IA o de una plantilla) a las tarjetas.
function _wzAplicarFiltros(f) {
    _wzLimpiarFiltros();
    const marcar = (sel, vals) => document.querySelectorAll(sel).forEach(c => { c.checked = (vals || []).includes(c.value); });
    marcar(".cat-material-chk", f.materiales);
    poblarOcasionesPills(f.ocasiones || []);
    poblarCategorias();
    marcar(".cat-cat-chk", f.categorias);
    _wzEl("cat-talla").value = (f.tallas || []).join(",");
    sincronizarChipsCatTalla();
    _wzEl("cat-tipo-an").value = f.tipoAN || "";
    _wzEl("cat-genero").value = f.genero || "";
    _catPrecio = { min: +f.precioMin || 0, max: +f.precioMax || 0 };
    if (f.prefijo) _wzEl("cat-prefijo-txt").value = f.prefijo;
    if (Object.keys(f).some(k => ["materiales", "tallas", "tipoAN", "genero", "precioMin", "precioMax", "prefijo"].includes(k) && (Array.isArray(f[k]) ? f[k].length : f[k])))
        _wzEl("wz-afinar").open = true;
    onPillChange();   // muestra/oculta la sección de anillos y vuelve a filtrar
}

// ── IA: «Pega lo que te pidió el cliente» ────────────────────────
async function wzEntender() {
    const txt = (_wzEl("cat-ia-prompt").value || "").trim();
    const out = _wzEl("cat-ia-resultado");
    if (!txt) return toast("⚠️ Pega o escribe lo que te pidió el cliente", "#f97316");
    const btn = _wzEl("wz-ia-btn");
    btn.disabled = true; btn.textContent = "⏳ Entendiendo…";
    let r = null;
    try {
        r = await fetch(API_URL, { method: "POST", body: JSON.stringify({
            accion: "IA_INTERPRETAR_PEDIDO", _pass: ADMIN_PASS, texto: txt.slice(0, 800),
            ocasiones: ocasionesLista().map(o => ({ id: o.id, nombre: o.nombre }))
        }) }).then(x => x.json());
    } catch (_) {}
    btn.disabled = false; btn.textContent = "Entender pedido";
    if (!r?.ok || !r.pedido) {
        // Sin IA (Worker sin actualizar, Groq caído…): búsqueda por palabras clave de siempre.
        aplicarPromptIA();
        out.insertAdjacentHTML("afterbegin", `<span style="color:#b45309;font-weight:600;">La IA no respondió, usé búsqueda por palabras:</span> `);
        return;
    }
    const pd = r.pedido;
    const ocConPiezas = (pd.ocasiones || []).filter(_ocasionTieneProductos);
    const ocSinPiezas = (pd.ocasiones || []).filter(id => !ocConPiezas.includes(id));
    _wzAplicarFiltros({ ...pd, ocasiones: ocConPiezas });
    if (pd.nombreCliente && !_wzEl("cat-nombre").value.trim()) _wzEl("cat-nombre").value = pd.nombreCliente;

    const nomOc = id => { const o = ocasionesLista(true).find(x => x.id === id); return `${o?.emoji || ""} ${o?.nombre || id}`.trim(); };
    const partes = [
        ...ocConPiezas.map(nomOc),
        ...(pd.categorias || []).map(k => CAT_MAP[k] || k),
        ...(pd.materiales || []).map(m => ({ plata: "Plata 925", acero: "Acero 316L", oro: "Oro / Laminado" }[m] || m)),
        ...(pd.tallas || []).map(t => "T" + t),
        ...(pd.tipoAN ? [WZ_TIPOS.find(x => x[0] === pd.tipoAN)?.[1]] : []),
        ...(pd.genero ? [WZ_GENEROS.find(x => x[0] === pd.genero)?.[1]] : []),
        ...(pd.precioMin || pd.precioMax ? [_wzTextoPrecio({ min: +pd.precioMin || 0, max: +pd.precioMax || 0 })] : []),
        ...(pd.nombreCliente ? ["👤 " + pd.nombreCliente] : []),
    ].filter(Boolean);
    out.innerHTML = `<b>Entendí:</b> ${partes.length ? partes.map(p => `<span class="wz-tag" style="padding-right:11px;">${esc(p)}</span>`).join("") : "nada concreto — elige las tarjetas abajo"}`
        + (ocSinPiezas.length ? `<span style="color:#b45309;">· aún no hay piezas etiquetadas como ${esc(ocSinPiezas.map(nomOc).join(" / "))}</span>` : "")
        + ((pd.noEntendido || []).length ? `<span style="color:#888;">· "${esc(pd.noEntendido.join('", "'))}" no es un filtro: lo eliges tú en las fotos</span>` : "");
}

// ── Paso 3: vigencia, promoción y vista previa ───────────────────
// Modo de la promo de ESTE catálogo: "no" | "general" | "custom". null = calcularlo de los campos.
let _wzModoPromo = null;
const _wzPromoAbiertas = new Set();   // tarjetas de promo con su editor abierto

function _wzPromoModo() {
    if (_wzModoPromo) return _wzModoPromo;
    if (_wzEl("cat-usar-promo-gral")?.checked) return "general";
    return WZ_PROMO_ITEMS.some(it => it.activo()) ? "custom" : "no";
}

const _wzVal = id => (_wzEl(id)?.value || "").trim();
const WZ_PROMO_ITEMS = [
    { k: "banner", ic: "🏷️", nm: "Banner",
      activo: () => !!_wzVal("cat-banner-txt"),
      estado: () => `“${_wzVal("cat-banner-txt")}”`,
      limpiar: () => ["cat-banner-txt", "cat-banner-sub"].forEach(id => _setVal(id, "")) },
    { k: "descuento", ic: "💸", nm: "Descuento",
      activo: () => (parseInt(_wzVal("cat-banner-desc-pct")) || 0) > 0,
      estado: () => `${Math.min(90, parseInt(_wzVal("cat-banner-desc-pct")) || 0)}% en todos los precios`,
      limpiar: () => _setVal("cat-banner-desc-pct", "") },
    { k: "carrito", ic: "🛒", nm: "Promo de carrito",
      activo: () => !!_wzVal("cat-promo-tipo"),
      estado: () => _etiquetaPromoCarrito(_leerPromoCarritoUI()) || ({ montoFijo: "Monto fijo: falta el monto", escalonado: "Escalonado: faltan los tramos" }[_wzVal("cat-promo-tipo")] || ""),
      limpiar: () => { ["cat-promo-montofijo", "cat-promo-montofijo-minimo"].forEach(id => _setVal(id, "")); [1, 2, 3].forEach(n => { _setVal(`cat-esc-cant-${n}`, ""); _setVal(`cat-esc-pct-${n}`, ""); }); _setVal("cat-promo-tipo", ""); onCambioPromoTipo(); } },
    { k: "envio", ic: "🚚", nm: "Envío gratis",
      activo: () => (parseFloat(_wzVal("cat-envio-gratis-desde")) || 0) > 0,
      estado: () => `Desde $${_wzVal("cat-envio-gratis-desde")}`,
      limpiar: () => _setVal("cat-envio-gratis-desde", "") },
    { k: "regalo", ic: "🎁", nm: "Regalo sorpresa",
      activo: () => (parseFloat(_wzVal("cat-regalo-monto")) || 0) > 0 || !!_wzVal("cat-regalo-texto"),
      estado: () => `${_wzVal("cat-regalo-texto") || "Regalo"} desde $${_wzVal("cat-regalo-monto") || "?"}`,
      limpiar: () => ["cat-regalo-monto", "cat-regalo-texto"].forEach(id => _setVal(id, "")) },
];
function wzDescuento(v) {
    _setVal("cat-banner-desc-pct", _wzVal("cat-banner-desc-pct") === String(v) ? "" : v);
    _wzPasarAPersonalizada();
    _wzPintarPromoItems();
    _wzPreview();
}
const WZ_DESCUENTOS = [10, 15, 20, 25, 30];
const WZ_CARRITO_TIPOS = [["2x50", "2do al 50%", "El más barato del par"], ["3x2", "3x2", "La 3ra pieza gratis"], ["montoFijo", "Monto fijo", "$ de descuento"], ["escalonado", "Escalonado", "% según cantidad"]];

function wzElegirPromo(modo) {
    const usar = _wzEl("cat-usar-promo-gral");
    _wzPromoAbiertas.clear();
    if (modo === "no")      { usar.checked = false; _limpiarPromosForm(); }
    if (modo === "general") { usar.checked = true; _cargarPromoEnForm(getPromoGeneral()); }
    if (modo === "custom")  { usar.checked = false; if (!WZ_PROMO_ITEMS.some(it => it.activo())) _wzPromoAbiertas.add("banner"); }
    _wzModoPromo = modo;
    actualizarResumenPromoCatalogo();
    wzPintarPaso3();
}

// Tocar una tarjeta: abre/cierra su editor. Si estaba en «Promo general», pasa a personalizada.
function wzPromoItem(k) {
    if (_wzPromoAbiertas.has(k)) _wzPromoAbiertas.delete(k); else _wzPromoAbiertas.add(k);
    _wzPintarPromoItems();
    if (_wzPromoAbiertas.has(k)) _wzEl("wz-ed-" + k)?.querySelector("input:not([type=hidden])")?.focus();
}

function wzPromoQuitar(k) {
    WZ_PROMO_ITEMS.find(it => it.k === k)?.limpiar();
    _wzPromoAbiertas.delete(k);
    _wzPasarAPersonalizada();
    if (!WZ_PROMO_ITEMS.some(it => it.activo())) { _wzModoPromo = "no"; _wzEl("cat-usar-promo-gral").checked = false; }
    actualizarResumenPromoCatalogo();
    wzPintarPaso3();
}

function wzCarritoTipo(t) {
    _setVal("cat-promo-tipo", _wzVal("cat-promo-tipo") === t ? "" : t);
    onCambioPromoTipo();
    _wzPasarAPersonalizada();
    _wzPintarPromoItems();
}

// Al tocar cualquier parte de la promo general, este catálogo pasa a ser «Personalizada»
// (la promo general guardada no cambia).
function _wzPasarAPersonalizada() {
    if (_wzPromoModo() === "general") { _wzModoPromo = "custom"; _wzEl("cat-usar-promo-gral").checked = false; }
}

// ── El banner debe decir lo mismo que la promo ──────────────────
// Detecta cuando el texto del banner menciona algo que este catálogo ya no
// incluye (ej. se quitó la promo de carrito pero el banner sigue diciendo
// «2do a mitad de precio»), para no mostrarle al cliente una oferta que no existe.
let _wzAvisoBannerOk = "";   // firma del aviso que el admin decidió dejar así
let _wzAvisoFirma = "";      // firma del aviso que se está mostrando
function _wzIncoherenciasBanner() {
    const txt = `${_wzVal("cat-banner-txt")} ${_wzVal("cat-banner-sub")}`.trim();
    if (!txt) return [];
    const t = txt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const activo = k => WZ_PROMO_ITEMS.find(it => it.k === k).activo();
    const tipo = _wzVal("cat-promo-tipo");
    const pct = parseInt(_wzVal("cat-banner-desc-pct")) || 0;
    const r = [];
    const mencionaCarrito = /\b2do\b|2°|segund[oa]|mitad de precio|3\s*x\s*2|tercer[ao]|la 3ra|escalonad|por cantidad/.test(t);
    if (mencionaCarrito && !activo("carrito")) r.push("una promo de carrito (2do a mitad, 3x2…) que ya no está activa");
    if (/envio/.test(t) && !activo("envio")) r.push("envío gratis, pero no está activo");
    if (/regalo|sorpresa|cortesia/.test(t) && !activo("regalo")) r.push("un regalo, pero no está activo");
    const porcentajes = [...t.matchAll(/(\d{1,2})\s*%/g)].map(m => parseInt(m[1]));
    const pctDeCarrito = mencionaCarrito || tipo === "2x50" || tipo === "escalonado";
    if (!pctDeCarrito) {
        if ((porcentajes.length || /descuento|\boff\b/.test(t)) && !pct && !activo("carrito")) r.push("un descuento, pero no hay % de descuento activo");
        else if (pct && porcentajes.length && !porcentajes.includes(pct)) r.push(`${porcentajes[0]}%, pero el descuento activo es ${pct}%`);
    }
    return r;
}

function _wzPintarAvisoBanner() {
    const caja = _wzEl("wz-banner-aviso");
    if (!caja) return;
    const r = _wzIncoherenciasBanner();
    const firma = r.join("|") + "|" + _wzVal("cat-banner-txt") + "|" + _wzVal("cat-banner-sub");
    _wzAvisoFirma = firma;
    caja.hidden = !r.length || _wzAvisoBannerOk === firma;
    if (caja.hidden) return;
    caja.innerHTML = `<b>⚠️ El banner no coincide con la promo.</b> Dice «${esc(_wzVal("cat-banner-txt"))}${_wzVal("cat-banner-sub") ? " · " + esc(_wzVal("cat-banner-sub")) : ""}» y menciona ${esc(r.join("; "))}.
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            <button type="button" class="wz-chip" onclick="wzPromoQuitar('banner')">🗑️ Quitar banner</button>
            <button type="button" class="wz-chip" onclick="wzEditarBanner()">✏️ Editar banner</button>
            <button type="button" class="wz-chip" style="color:#888;" onclick="_wzAvisoBannerOk=_wzAvisoFirma;_wzPintarAvisoBanner()">Dejarlo así</button>
        </div>`;
}

function wzEditarBanner() {
    _wzPromoAbiertas.add("banner");
    _wzPintarPromoItems();
    _wzEl("cat-banner-txt").focus();
    _wzEl("cat-banner-txt").select();
}

function _wzPintarPromoItems() {
    const cont = _wzEl("wz-promo-items");
    if (!cont) return;
    cont.innerHTML = WZ_PROMO_ITEMS.map(it => {
        const on = it.activo(), abierta = _wzPromoAbiertas.has(it.k);
        return `<div class="wz-card wz-pitem${on ? " on" : " vacia"}${abierta ? " abierta" : ""}" role="button" tabindex="0" onclick="wzPromoItem('${it.k}')" onkeydown="if(event.key==='Enter')wzPromoItem('${it.k}')">
            <span class="ic">${it.ic}</span><span class="nm">${it.nm}</span>
            <span class="ct">${on ? esc(it.estado()) : "+ Agregar"}</span>
            ${on ? `<button type="button" class="wz-x" title="Quitar ${it.nm}" aria-label="Quitar ${it.nm}" onclick="event.stopPropagation();wzPromoQuitar('${it.k}')">✕</button>` : ""}
        </div>`;
    }).join("");
    WZ_PROMO_ITEMS.forEach(it => { const ed = _wzEl("wz-ed-" + it.k); if (ed) ed.hidden = !_wzPromoAbiertas.has(it.k); });
    const pctAct = _wzVal("cat-banner-desc-pct");
    _wzEl("wz-desc-rapidos").innerHTML = WZ_DESCUENTOS.map(v =>
        `<button type="button" class="wz-card${pctAct === String(v) ? " on" : ""}" onclick="wzDescuento(${v})"><span class="nm">${v}%</span></button>`).join("");
    const nota = _wzEl("wz-desc-nota");
    if (nota) nota.textContent = (parseInt(pctAct) || 0) > 0 && !_wzVal("cat-banner-txt")
        ? `Como no hay banner, el cliente verá uno automático: «${_textoBannerDescuento(Math.min(90, parseInt(pctAct)))}».`
        : "Se resta de todos los precios del catálogo y el cliente ve el precio antes y después.";
    const tipo = _wzVal("cat-promo-tipo");
    _wzEl("wz-carrito-tipos").innerHTML = WZ_CARRITO_TIPOS.map(([v, nm, ct]) =>
        `<button type="button" class="wz-card${tipo === v ? " on" : ""}" onclick="wzCarritoTipo('${v}')"><span class="nm">${nm}</span><span class="ct">${ct}</span></button>`).join("");
    const modo = _wzPromoModo();
    document.querySelectorAll("#wz-promo .wz-card").forEach(c => c.classList.toggle("on", c.dataset.modo === modo));
    _wzPintarAvisoBanner();
}

function wzPintarPaso3() {
    const dias = _wzEl("cat-validez").value;
    _wzEl("wz-vig").innerHTML = WZ_VIGENCIAS.map(([v, t]) =>
        `<button type="button" class="wz-card${dias === v ? " on" : ""}" onclick="document.getElementById('cat-validez').value='${v}';wzPintarPaso3()"><span class="nm">${t}</span></button>`).join("");

    const esAf = _wzEl("cat-es-afiliado").checked, esUS = _wzEl("cat-es-us")?.checked;
    _wzEl("cat-banner-wrap").style.display = (esAf || esUS) ? "none" : "block";

    const modo = _wzPromoModo();
    const pg = getPromoGeneral();
    const resumenGral = [pg.banner?.txt, pg.descPct > 0 ? `${pg.descPct}% de descuento` : "", pg.promoCarrito ? _etiquetaPromoCarrito(pg.promoCarrito) : "", pg.envioGratisDesde > 0 ? `envío gratis desde $${pg.envioGratisDesde}` : "", pg.regaloSorpresa?.monto > 0 ? `regalo desde $${pg.regaloSorpresa.monto}` : ""].filter(Boolean).join(" · ") || "sin nada guardado aún";
    _wzEl("wz-promo").innerHTML = [
        ["no", "🚫", "Sin promo", "Precios normales"],
        ["general", "🎁", "Promo general", resumenGral],
        ["custom", "✏️", "Personalizada", "Arma la promo solo para este link"],
    ].map(([m, ic, nm, ct]) => `<button type="button" class="wz-card" data-modo="${m}" onclick="wzElegirPromo('${m}')"><span class="ic">${ic}</span><span class="nm">${nm}</span><span class="ct">${esc(ct)}</span></button>`).join("");
    _wzEl("cat-promo-detalle").style.display = modo === "no" ? "none" : "block";
    _wzPintarPromoItems();
    wzActualizarBarra();
}

function _wzPreview() {
    const lista = _wzEl("wz-ph-list");
    if (!lista) return;
    const esAf = _wzEl("cat-es-afiliado").checked, esUS = _wzEl("cat-es-us")?.checked;
    const nombre = esAf ? (_wzEl("cat-afiliado-nombre").value || "") : (_wzEl("cat-nombre").value || "").trim();
    _wzEl("wz-ph-hi").textContent = esAf ? `Catálogo de ${nombre || "tu afiliado"}` : (nombre ? `Hola ${nombre}, elegimos esto para ti` : "Catálogo exclusivo");
    const pct = (esAf || esUS) ? 0 : Math.min(90, Math.max(0, parseInt(_wzEl("cat-banner-desc-pct").value) || 0));
    const bTxt = (_wzEl("cat-banner-txt").value || "").trim() || (pct ? _textoBannerDescuento(pct) : "");
    const conBanner = !esAf && !esUS && bTxt;
    const ban = _wzEl("wz-ph-ban");
    ban.hidden = !conBanner;
    if (conBanner) { ban.style.background = _bannerColor; ban.innerHTML = `${esc(bTxt)}<small>${esc((_wzEl("cat-banner-sub").value || "").trim())}</small>`; }
    const cods = new Set([...document.querySelectorAll("#cat-lista .cat-chk:checked")].map(c => c.dataset.cod));
    const elegidos = _catFiltrada.filter(p => cods.has(p._codigos?.[0] || p.codigo));
    lista.innerHTML = elegidos.slice(0, 40).map(p => {
        const precio = parseFloat(p.precio || 0), img = ikSharp(p.foto || p.img || "");
        return `<div class="it"><div class="ph">${img ? `<img src="${img}" loading="lazy" alt="">` : "💍"}</div>
            <div class="t">${esc(p.nombre || "—")}<br>${pct ? `<s>$${precio.toFixed(2)}</s>` : ""}$${(precio * (1 - pct / 100)).toFixed(2)}</div></div>`;
    }).join("") + (elegidos.length > 40 ? `<div style="grid-column:1/-1;text-align:center;font-size:11px;color:#888;">+ ${elegidos.length - 40} más</div>` : "");
    const env = parseFloat(_wzEl("cat-envio-gratis-desde").value) || 0;
    _wzEl("wz-ph-foot").textContent = `Vista aproximada · válido ${_wzEl("cat-validez").value} días${!esAf && !esUS && env > 0 ? ` · envío gratis desde $${env}` : ""}`;
}

// ── Plantillas guardadas (config.plantillasCatalogo) ──────────────
function _wzPlantillas() { return Array.isArray(cfg.plantillasCatalogo) ? cfg.plantillasCatalogo : []; }

function _wzResumenPlantilla(t) {
    const oc = (t.ocasiones || []).map(id => ocasionesLista(true).find(o => o.id === id)?.nombre).filter(Boolean);
    const cat = (t.categorias || []).map(k => (CAT_MAP[k] || k).replace(/^\S+\s/, ""));
    return [...oc, ...cat, ...(t.tallas || []).map(x => "T" + x), t.precio && (t.precio.min || t.precio.max) ? _wzTextoPrecio(t.precio) : "",
        t.validez ? `${t.validez} días` : "", t.promo === "general" ? "promo general" : "",
        ...(t.promo === "custom" ? _wzResumenPromoDatos(t.promoDatos) : [])].filter(Boolean).join(" · ");
}

function _wzResumenPromoDatos(pd) {
    if (!pd) return ["promo propia"];
    const r = [];
    if (pd.descPct > 0) r.push(`${pd.descPct}% desc.`);
    if (pd.banner?.txt) r.push(`banner «${pd.banner.txt}»`);
    if (pd.promoCarrito) r.push(_etiquetaPromoCarrito(pd.promoCarrito));
    if (pd.envioGratisDesde > 0) r.push(`envío gratis desde $${pd.envioGratisDesde}`);
    if (pd.regaloSorpresa?.monto > 0) r.push(`regalo desde $${pd.regaloSorpresa.monto}`);
    return r.length ? r : ["sin promo"];
}

// La promo que hay ahora en el formulario, con la misma forma que la promo general
// (así _cargarPromoEnForm la puede volver a poner tal cual).
function _wzLeerPromoDatos() {
    const bTxt = _wzVal("cat-banner-txt");
    const rMonto = parseFloat(_wzVal("cat-regalo-monto")) || 0, rTexto = _wzVal("cat-regalo-texto");
    return {
        banner: bTxt ? { txt: bTxt, sub: _wzVal("cat-banner-sub"), color: _bannerColor } : null,
        descPct: Math.min(90, Math.max(0, parseInt(_wzVal("cat-banner-desc-pct")) || 0)),
        promoCarrito: _leerPromoCarritoUI(),
        envioGratisDesde: parseFloat(_wzVal("cat-envio-gratis-desde")) || 0,
        regaloSorpresa: (rMonto > 0 || rTexto) ? { monto: rMonto, texto: rTexto } : null,
    };
}

function wzRenderPlantillas() {
    const cont = _wzEl("wz-plantillas"), lista = _wzPlantillas();
    if (!cont) return;
    _wzEl("wz-plantillas-hint").textContent = lista.length ? `${lista.length} guardada${lista.length > 1 ? "s" : ""}` : "ninguna todavía";
    cont.innerHTML = lista.length ? lista.map((t, i) => `
        <div class="wz-card" role="button" tabindex="0" onclick="wzUsarPlantilla(${i})" onkeydown="if(event.key==='Enter')wzUsarPlantilla(${i})">
            <span class="ic">${esc(t.emoji || "📁")}</span><span class="nm">${esc(t.nombre)}</span><span class="ct">${esc(_wzResumenPlantilla(t))}</span>
            <button type="button" onclick="event.stopPropagation();wzBorrarPlantilla(${i})" title="Borrar plantilla" style="position:absolute;top:6px;right:6px;border:0;background:none;color:#aaa;cursor:pointer;font-size:13px;">✕</button>
        </div>`).join("")
        : `<div style="font-size:12.5px;color:#888;grid-column:1/-1;">Arma un catálogo y en el paso 3 toca «📁 Guardar estos filtros como plantilla» para reusarlo con un clic.</div>`;
}

async function _wzGuardarListaPlantillas(lista) {
    const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "ACTUALIZAR_CONFIG", _pass: ADMIN_PASS, config: { plantillasCatalogo: lista } }) }).then(x => x.json()).catch(() => null);
    if (!r?.ok) { toast("❌ No se pudo guardar la plantilla", "#ef4444"); return false; }
    cfg.plantillasCatalogo = lista;
    try { localStorage.setItem("vx_cfg", JSON.stringify(cfg)); } catch (_) {}
    wzRenderPlantillas();
    return true;
}

async function wzGuardarPlantilla() {
    const ocs = ocasionesSeleccionadas();
    const o0 = ocasionesLista(true).find(o => o.id === ocs[0]);
    const cats = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);
    const sugerido = [o0?.nombre, ...cats.map(k => (CAT_MAP[k] || "").replace(/^\S+\s/, ""))].filter(Boolean).join(" · ") || "Mi plantilla";
    const nombre = (prompt("Nombre de la plantilla:", sugerido) || "").trim().slice(0, 40);
    if (!nombre) return;
    const t = {
        id: Date.now().toString(36), nombre,
        emoji: o0?.emoji || (cats[0] ? CAT_MAP[cats[0]].split(" ")[0] : "📁"),
        ocasiones: ocs, categorias: cats,
        materiales: [...document.querySelectorAll(".cat-material-chk:checked")].map(c => c.value),
        tallas: (_wzEl("cat-talla").value || "").split(",").filter(Boolean),
        tipoAN: _wzEl("cat-tipo-an").value, genero: _wzEl("cat-genero").value,
        precio: { ..._catPrecio }, prefijo: (_wzEl("cat-prefijo-txt").value || "").trim(),
        validez: _wzEl("cat-validez").value, promo: _wzPromoModo(),
        cantidad: parseInt(_wzEl("cat-var-size").value) || 36,
    };
    // «Personalizada»: se guarda la promo completa (descuento, banner, carrito, envío, regalo).
    if (t.promo === "custom") t.promoDatos = _wzLeerPromoDatos();
    const lista = _wzPlantillas();
    const iExiste = lista.findIndex(x => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (iExiste >= 0) {
        if (!confirm(`Ya tienes una plantilla «${lista[iExiste].nombre}». ¿Actualizarla con lo que tienes ahora (filtros, vigencia y promo)?`)) return;
        t.id = lista[iExiste].id;
        const nueva = lista.slice(); nueva[iExiste] = t;
        if (await _wzGuardarListaPlantillas(nueva)) toast(`📁 Plantilla «${nombre}» actualizada`, "#22c55e");
        return;
    }
    if (await _wzGuardarListaPlantillas([...lista, t].slice(-30))) toast(`📁 Plantilla «${nombre}» guardada`, "#22c55e");
}

async function wzBorrarPlantilla(i) {
    const t = _wzPlantillas()[i];
    if (!t || !confirm(`¿Borrar la plantilla «${t.nombre}»?`)) return;
    if (await _wzGuardarListaPlantillas(_wzPlantillas().filter((_, j) => j !== i))) toast("Plantilla borrada", "#111");
}

function wzUsarPlantilla(i) {
    const t = _wzPlantillas()[i];
    if (!t) return;
    _wzAplicarFiltros({ ...t, precioMin: t.precio?.min, precioMax: t.precio?.max });
    if (t.validez) _wzEl("cat-validez").value = t.validez;
    if (t.cantidad) _wzEl("cat-var-size").value = t.cantidad;
    if (t.promo && !_wzEl("cat-es-afiliado").checked) {
        if (t.promo === "custom" && t.promoDatos) {
            _cargarPromoEnForm(t.promoDatos);          // queda en sus tarjetas, editable solo para este link
            _wzEl("cat-usar-promo-gral").checked = false;
            _wzModoPromo = "custom"; _wzPromoAbiertas.clear();
            actualizarResumenPromoCatalogo();
        } else wzElegirPromo(t.promo);
    }
    toast(`📁 Plantilla «${t.nombre}» aplicada`, "#22c55e");
    wzIr(2);
}

// Cualquier cambio de selección/filtro (también los que hace el código: IA,
// recetas, «Al azar»…) repinta tarjetas, filtros activos y la barra de abajo.
document.addEventListener("DOMContentLoaded", () => {
    ["filtrarParaCatalogo", "seleccionarTodosCatalogo", "elegirAzarFiltrado", "autoSeleccionarVariado", "aplicarPromptIA", "refrescarCatalogoAfiliado"].forEach(n => {
        const orig = window[n];
        if (typeof orig !== "function") return;
        window[n] = function (...args) {
            const r = orig.apply(this, args);
            _wzTrasFiltrar();
            if (r && typeof r.then === "function") r.then(_wzTrasFiltrar, () => {});
            return r;
        };
    });
    _wzEl("modal-catalogo")?.addEventListener("change", e => { if (e.target.matches(".cat-chk")) wzActualizarBarra(); });
    ["input", "change"].forEach(ev => _wzEl("modal-catalogo")?.addEventListener(ev, () => { if (_wzPaso === 3) _wzPreview(); }));
    // Solo «input» (mientras se escribe): con «change», que salta al salir del campo,
    // las tarjetas se redibujaban justo bajo el clic y ese clic se perdía.
    _wzEl("cat-promo-detalle")?.addEventListener("input", e => {
        if (!e.target.matches("input") || e.target.id === "promo-gral-activa") return;
        _wzPasarAPersonalizada();
        _wzPintarPromoItems();
    });
});
