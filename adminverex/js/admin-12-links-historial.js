// Admin VEREX — Promo general de catálogos, historial de links y registro de catálogos
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ── PROMO GENERAL DE CATÁLOGOS (solo Cliente) ───────────────────────────────
// La promo de carrito / banner / envío gratis / regalo vivían solo dentro de
// cada catálogo y el formulario los reiniciaba a vacío en cada catálogo nuevo,
// así que había que volver a elegirlos siempre. Ahora hay UNA promo general
// (cfg.promoGeneral, se guarda en el servidor y viaja a todos los dispositivos)
// que se precarga sola en cada catálogo de cliente; el formulario de siempre
// sigue siendo lo que se envía, así que se puede personalizar un catálogo suelto.
// Nunca aplica a Afiliado (ellos ganan comisión por venta).
const PROMO_GENERAL_DEFAULT = {
    activa: true,
    banner: { txt: "🎁 2do producto a mitad de precio", sub: "Envío gratis desde $30", color: "#7c3aed" },
    promoCarrito: { tipo: "2x50" },
    envioGratisDesde: 30,
    regaloSorpresa: { monto: 0, texto: "🎁" } // monto 0 = sin regalo hasta que se ponga un monto
};
function getPromoGeneral() { return cfg.promoGeneral || PROMO_GENERAL_DEFAULT; }

function _setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

function _refrescarPreviewBanner() {
    const prev = document.getElementById("banner-preview");
    const txt = (document.getElementById("cat-banner-txt")?.value || "").trim();
    if (!prev) return;
    if (txt) { prev.style.display = "block"; prev.style.background = _bannerColor; prev.textContent = txt; }
    else prev.style.display = "none";
}

function _limpiarPromosForm() {
    ["cat-banner-txt", "cat-banner-sub", "cat-banner-desc-pct", "cat-promo-montofijo", "cat-promo-montofijo-minimo",
     "cat-envio-gratis-desde", "cat-regalo-monto", "cat-regalo-texto"].forEach(id => _setVal(id, ""));
    [1, 2, 3].forEach(n => { _setVal(`cat-esc-cant-${n}`, ""); _setVal(`cat-esc-pct-${n}`, ""); });
    _setVal("cat-promo-tipo", ""); onCambioPromoTipo();
    _refrescarPreviewBanner();
}

function _textoBannerDescuento(pct) { return `${pct}% de descuento en todo el catálogo`; }

function _cargarPromoEnForm(pg) {
    _limpiarPromosForm();
    if (pg.banner?.txt) {
        _setVal("cat-banner-txt", pg.banner.txt); _setVal("cat-banner-sub", pg.banner.sub || "");
        const color = pg.banner.color || "#ef4444";
        const btn = document.querySelector(`#banner-colors button[data-banner-color="${color}"]`);
        if (btn) selBannerColor(btn, color); else _bannerColor = color;
        _refrescarPreviewBanner();
    }
    const pc = pg.promoCarrito;
    if (pc?.tipo) {
        _setVal("cat-promo-tipo", pc.tipo); onCambioPromoTipo();
        if (pc.tipo === "montoFijo") { _setVal("cat-promo-montofijo", pc.montoFijo || ""); _setVal("cat-promo-montofijo-minimo", pc.minimoCompra || ""); }
        if (pc.tipo === "escalonado") (pc.escalones || []).slice(0, 3).forEach((e, i) => { _setVal(`cat-esc-cant-${i + 1}`, e.minCant); _setVal(`cat-esc-pct-${i + 1}`, e.pct); });
    }
    if (pg.descPct > 0) _setVal("cat-banner-desc-pct", pg.descPct);
    if (pg.envioGratisDesde > 0) _setVal("cat-envio-gratis-desde", pg.envioGratisDesde);
    if (pg.regaloSorpresa) {
        _setVal("cat-regalo-monto", pg.regaloSorpresa.monto > 0 ? pg.regaloSorpresa.monto : "");
        _setVal("cat-regalo-texto", pg.regaloSorpresa.texto || "");
    }
}

function _etiquetaPromoCarrito(pc) {
    if (!pc) return "";
    if (pc.tipo === "2x50") return "2do producto al 50%";
    if (pc.tipo === "3x2") return "3x2 (la 3ra gratis)";
    if (pc.tipo === "montoFijo") return `$${pc.montoFijo} de descuento` + (pc.minimoCompra ? ` desde $${pc.minimoCompra}` : "");
    if (pc.tipo === "escalonado") return "Descuento escalonado por cantidad";
    return pc.tipo;
}

// Resumen de lo que ESTE catálogo va a llevar — se calcula de los campos del
// formulario (no de la config), así siempre dice la verdad aunque se personalice.
function actualizarResumenPromoCatalogo() {
    const el = document.getElementById("promo-gral-resumen");
    if (!el) return;
    const chips = [];
    const pc = _leerPromoCarritoUI();
    if (pc) chips.push("🎁 " + _etiquetaPromoCarrito(pc));
    const env = parseFloat(document.getElementById("cat-envio-gratis-desde")?.value) || 0;
    if (env > 0) chips.push(`🚚 Envío gratis desde $${env}`);
    const rMonto = parseFloat(document.getElementById("cat-regalo-monto")?.value) || 0;
    const rTexto = (document.getElementById("cat-regalo-texto")?.value || "").trim();
    if (rMonto > 0 && rTexto) chips.push(`${rTexto} Regalo sorpresa desde $${rMonto}`);
    const bTxt = (document.getElementById("cat-banner-txt")?.value || "").trim();
    if (bTxt) chips.push(`🏷️ Banner: “${bTxt}”`);
    el.innerHTML = chips.length
        ? chips.map(c => `<span style="display:inline-block;background:#fff;border:1px solid #e2e2e2;border-radius:20px;padding:3px 10px;margin:0 6px 6px 0;font-size:11px;font-weight:600;color:#111;">${esc(c)}</span>`).join("")
        : `<span style="color:#777;">Este catálogo saldrá sin promociones.</span>`;
}

// Sincroniza el interruptor general y la casilla "incluirla" con la config.
function _sincronizarTarjetaPromo() {
    const activa = !!getPromoGeneral().activa;
    const sw = document.getElementById("promo-gral-activa");
    const swTxt = document.getElementById("promo-gral-activa-txt");
    if (sw) sw.checked = activa;
    if (swTxt) { swTxt.textContent = activa ? "Activa" : "Apagada"; swTxt.style.color = activa ? "#15803d" : "#777"; }
    const usar = document.getElementById("cat-usar-promo-gral");
    if (usar) { usar.disabled = !activa; if (!activa) usar.checked = false; }
    const lblUsar = document.getElementById("cat-usar-promo-gral-lbl");
    if (lblUsar) lblUsar.style.opacity = activa ? "1" : "0.5";
}

// Se llama al abrir "Catálogo Cliente": deja el formulario limpio y, si la
// promo general está activa, la precarga.
function iniciarPromoGeneralEnModal() {
    // Antes, mientras cfg.promoGeneral fuera undefined, esta pantalla solo
    // MOSTRABA el default (PROMO_GENERAL_DEFAULT) como vista previa — se veía
    // "Activa" pero nunca se guardaba en el servidor hasta que alguien tocara
    // el interruptor o el botón de guardar. Cualquier otro lector del dato
    // guardado (ej. el botón de promo general en Venta Directa) encontraba la
    // config vacía. Ahora, la primera vez que se abre esta pantalla sin nada
    // guardado, se persiste el default de una vez — deja de ser solo una vista previa.
    if (!cfg.promoGeneral) { cfg.promoGeneral = { ...PROMO_GENERAL_DEFAULT }; saveConfig(); }
    const pg = getPromoGeneral();
    _limpiarPromosForm();
    const usar = document.getElementById("cat-usar-promo-gral");
    if (usar) usar.checked = !!pg.activa;
    if (pg.activa) _cargarPromoEnForm(pg);
    const det = document.getElementById("cat-promo-detalle");
    if (det) det.style.display = "none";
    const btn = document.getElementById("btn-promo-detalle");
    if (btn) btn.textContent = "✏️ Personalizar este catálogo ▾";
    _sincronizarTarjetaPromo();
    actualizarResumenPromoCatalogo();
}

// Casilla "Incluirla en este catálogo": recarga la promo general o la quita
// solo de este catálogo (no cambia la config).
function usarPromoGeneralEnCatalogo(usar) {
    if (usar) _cargarPromoEnForm(getPromoGeneral()); else _limpiarPromosForm();
    actualizarResumenPromoCatalogo();
}

// Interruptor general: apaga/enciende la promo para TODOS los catálogos nuevos
// (los valores guardados se conservan para volver a encenderla).
function alternarPromoGeneral(activa) {
    cfg.promoGeneral = { ...getPromoGeneral(), activa };
    saveConfig();
    _sincronizarTarjetaPromo();
    // Solo cambia lo que se precarga en los catálogos NUEVOS; la promo del catálogo
    // que se está armando no se toca (antes este interruptor la borraba o recargaba).
    toast(activa ? "✅ Promo general activa — se precarga en cada catálogo de cliente" : "Promo general apagada — los catálogos nuevos salen sin promociones", activa ? "#22c55e" : "#111");
}

function togglePromoDetalle() {
    const det = document.getElementById("cat-promo-detalle");
    const btn = document.getElementById("btn-promo-detalle");
    if (!det) return;
    const abrir = det.style.display === "none";
    det.style.display = abrir ? "block" : "none";
    if (btn) btn.textContent = abrir ? "✏️ Ocultar ajustes ▴" : "✏️ Personalizar este catálogo ▾";
}

// Toma lo que hay en el formulario y lo deja como la promo general nueva.
function guardarFormComoPromoGeneral() {
    const bTxt = (document.getElementById("cat-banner-txt")?.value || "").trim();
    const pc = _leerPromoCarritoUI();
    const env = parseFloat(document.getElementById("cat-envio-gratis-desde")?.value) || 0;
    const rMonto = parseFloat(document.getElementById("cat-regalo-monto")?.value) || 0;
    const rTexto = (document.getElementById("cat-regalo-texto")?.value || "").trim();
    const pct = Math.min(90, Math.max(0, parseInt(document.getElementById("cat-banner-desc-pct")?.value) || 0));
    if (!bTxt && !pc && !(env > 0) && !(rMonto > 0) && !pct) return toast("⚠️ No hay ninguna promoción en el formulario para guardar", "#f97316");
    if (!confirm("Estos ajustes pasarán a ser la PROMO GENERAL: se precargarán en todos los catálogos nuevos de cliente.\n\n¿Guardar?")) return;
    cfg.promoGeneral = {
        activa: true,
        banner: bTxt ? { txt: bTxt, sub: (document.getElementById("cat-banner-sub")?.value || "").trim(), color: _bannerColor } : null,
        descPct: pct,
        promoCarrito: pc,
        envioGratisDesde: env,
        regaloSorpresa: (rMonto > 0 || rTexto) ? { monto: rMonto, texto: rTexto } : null
    };
    saveConfig();
    const usar = document.getElementById("cat-usar-promo-gral");
    if (usar) usar.checked = true;
    _sincronizarTarjetaPromo();
    actualizarResumenPromoCatalogo();
    if (_wzPaso === 3) { _wzModoPromo = "general"; wzPintarPaso3(); }
    toast("✅ Promo general guardada", "#22c55e");
}

// El resumen se actualiza solo mientras se edita cualquier campo de ajustes.
["input", "change"].forEach(ev => document.addEventListener(ev, e => {
    if (e.target.closest?.("#cat-promo-detalle, #wz-mas-opciones")) actualizarResumenPromoCatalogo();
}));

// ── HISTORIAL DE LINKS ──────────────────────────────────────────────────────
let _histLinks = [];

async function cargarHistorialLinks() {
    const cont = document.getElementById("hist-links-list");
    cont.innerHTML = '<p style="color:#666;font-size:13px;">Cargando…</p>';
    try {
        const res = await fetch("/list-catalogs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _pass: ADMIN_PASS })
        });
        const json = await res.json();
        _histLinks = json.links || [];
        _renderHistLinks("todos");
    } catch(e) {
        cont.innerHTML = '<p style="color:#e74c3c;font-size:13px;">Error al cargar historial.</p>';
    }
}

function filtrarHistLinks(btn) {
    document.querySelectorAll(".hist-filter").forEach(b => {
        b.style.background = "none"; b.style.color = "#aaa"; b.style.borderColor = "#444";
    });
    btn.style.background = "rgba(201,168,76,0.15)"; btn.style.color = "#C9A84C"; btn.style.borderColor = "#C9A84C";
    _renderHistLinks(btn.dataset.f);
}

function _renderHistLinks(filtro) {
    const cont = document.getElementById("hist-links-list");
    let lista = _histLinks;
    if (filtro === "cliente")  lista = lista.filter(l => l.tipo === "cliente");
    if (filtro === "afiliado") lista = lista.filter(l => l.tipo === "afiliado");
    if (filtro === "vencido")  lista = lista.filter(l => !l.activo);
    if (!lista.length) {
        cont.innerHTML = '<p style="color:#666;font-size:13px;text-align:center;padding:16px 0;">Sin registros.</p>';
        return;
    }
    cont.innerHTML = lista.map(l => {
        const esAfil  = l.tipo === "afiliado";
        const badge   = esAfil
            ? `<span style="background:rgba(168,125,32,0.2);color:#C9A84C;border:1px solid #C9A84C;border-radius:12px;padding:2px 9px;font-size:11px;white-space:nowrap;">🤝 Afiliado</span>`
            : `<span style="background:rgba(14,165,233,0.15);color:#38bdf8;border:1px solid #38bdf8;border-radius:12px;padding:2px 9px;font-size:11px;white-space:nowrap;">📋 Cliente</span>`;
        const estado  = l.activo
            ? `<span style="color:#22c55e;font-size:12px;white-space:nowrap;">🟢 Activo</span>`
            : `<span style="color:#ef4444;font-size:12px;white-space:nowrap;">🔴 Vencido</span>`;
        const fCreado  = new Date(l.createdAt).toLocaleDateString("es-SV",{day:"2-digit",month:"2-digit",year:"2-digit"});
        const fExpira  = new Date(l.expiresAt).toLocaleDateString("es-SV",{day:"2-digit",month:"2-digit",year:"2-digit"});
        const url      = `https://admin-tienda.pages.dev/c/${l.id}`;
        const nProd    = l.data?.prods?.length || 0;
        return `
        <div style="background:#ffffff;border:2.5px solid ${l.activo ? '#6ee7b7' : '#fca5a5'};border-radius:10px;padding:12px 14px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;">
                        ${badge} ${estado}
                    </div>
                    <div style="font-size:14px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${l.nombre || "(Sin nombre)"}${l.afiliadoCodigo ? ` <span style="color:#6b7280;font-size:12px;">(${l.afiliadoCodigo})</span>` : ""}
                    </div>
                    <div style="font-size:11px;color:#9ca3af;margin-top:3px;">
                        ${nProd} producto${nProd!==1?"s":""} · Creado: ${fCreado} · Vence: ${fExpira}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0;">
                    <button onclick="navigator.clipboard.writeText('${url}');toast('✅ Link copiado','#22c55e')"
                        style="background:#f9fafb;border:1px solid #e5e7eb;color:#374151;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer;">
                        📋 Copiar link
                    </button>
                    ${!l.activo ? `
                    <div style="display:flex;gap:5px;align-items:center;">
                        <select id="dias-react-${l.id}" style="background:#fff;border:1px solid #fcd34d;color:#111;border-radius:7px;padding:4px 6px;font-size:11px;">
                            <option value="1">1 día</option>
                            <option value="7">7 días</option>
                            <option value="15" selected>15 días</option>
                            <option value="30">30 días</option>
                        </select>
                        <button onclick="reactivarLink('${l.id}')"
                            style="background:#B8860B;border:none;color:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
                            ↺ Reactivar
                        </button>
                    </div>` : `
                    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
                        ${esAfil ? `<button onclick="abrirAgregarProductos('${l.id}','${(l.nombre||'').replace(/'/g,'\\\'')}')"
                            style="background:#f0fdf4;border:1px solid #a7f3d0;color:#065f46;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap;">
                            ✚ Agregar productos
                        </button>` : ''}
                        <button onclick="eliminarLink('${l.id}')"
                            style="background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap;">
                            🗑 Eliminar
                        </button>
                    </div>`}
                </div>
            </div>
        </div>`;
    }).join("");
}

let _editandoLinkId = null;  // cuando está en modo "agregar a link existente"

function abrirAgregarProductos(id, nombre) {
    _editandoLinkId = id;
    // Abrir el modal de catálogo afiliado con la UI normal de selección de productos
    abrirModalCatalogo("afiliado");
    // Marcar visualmente que estamos en modo edición
    const titulo = document.getElementById("modal-catalogo-titulo");
    if (titulo) titulo.innerHTML = `✚ Agregar productos a <span style="color:#C9A84C;">${nombre || id}</span>`;
    // Cambiar el botón de generar para que haga "Agregar" en vez de crear link nuevo
    const btn = document.getElementById("btn-gen-link");
    if (btn) {
        btn.textContent = "✚ Agregar al link";
        btn.onclick = agregarProductosAlLink;
    }
}

function _resetModalCatalogo() {
    if (!_editandoLinkId) return;
    _editandoLinkId = null;
    const btn = document.getElementById("btn-gen-link");
    if (btn) { btn.textContent = "🔗 Crear link"; btn.onclick = generarLinkCatalogo; }
}

async function agregarProductosAlLink() {
    const codsSel = [...document.querySelectorAll(".cat-chk:checked")].map(c => c.dataset.cod);
    if (!codsSel.length) return toast("⚠️ Selecciona al menos un producto", "#f97316");

    const talla  = document.getElementById("cat-talla").value;
    const genero = document.getElementById("cat-genero")?.value || "";
    const lista  = _catFiltrada.filter(p => codsSel.includes(p._codigos?.[0] || p.codigo));

    const nuevosProductos = lista.map(p => {
        const szExport = _sizesParaExport(p, talla, genero);
        return {
            n: p.nombre || "—",
            p: parseFloat(p.precio || 0).toFixed(2),
            i: p.foto || p.img || "",
            m: p.material || detectarMaterial(p.nombre) || "",
            cat: p._catKey || getCatKey(p),
            c: p._codigos?.[0] || p.codigo || "",
            sizes:  szExport.sizes,
            sizesD: szExport.sizesD,
            sizesH: szExport.sizesH,
            par:    p._esPareja || false,
            piezas: p._piezas || (p._esPareja ? 2 : null),
            pD: p._precioDama || null,
            pH: p._precioCab  || null,
            cD: p._piezasCodigosDama || null,
            cC: p._piezasCodigosCab  || null,
            avisoPieza: /matrimonio|argolla|novios|pareja|alianza/i.test(p.nombre || ""),
            ne:   getNotaEspecial(p),
            nota: (document.querySelector(`.cat-nota[data-cod="${p._codigos?.[0] || p.codigo}"]`)?.value || "").trim()
        };
    });

    const btn = document.getElementById("btn-gen-link");
    btn.disabled = true; btn.textContent = "⏳ Agregando...";

    try {
        const res = await fetch("/edit-catalog-products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: _editandoLinkId, nuevosProductos, _pass: ADMIN_PASS })
        });
        const json = await res.json();
        if (json.ok) {
            toast(`✅ ${codsSel.length} producto${codsSel.length !== 1 ? "s" : ""} agregado${codsSel.length !== 1 ? "s" : ""} — total en link: ${json.totalProductos}`, "#22c55e");
            cerrarModalCatalogo();
            _resetModalCatalogo();
            cargarHistorialLinks();
        } else {
            toast("❌ " + (json.error || "Error al agregar"), "#ef4444");
        }
    } catch(e) {
        toast("❌ " + e.message, "#ef4444");
    } finally {
        btn.disabled = false;
        btn.textContent = "✚ Agregar al link";
    }
}

async function eliminarLink(id) {
    if (!confirm("¿Eliminar este link del historial? Esta acción no se puede deshacer.")) return;
    try {
        const res  = await fetch("/deactivate-catalog", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, eliminarHistorial: true, _pass: ADMIN_PASS })
        });
        const json = await res.json();
        if (json.ok) {
            toast("🗑 Link eliminado", "#22c55e");
            cargarHistorialLinks();
        } else {
            toast("❌ " + (json.error || "Error"), "#ef4444");
        }
    } catch(e) {
        toast("❌ " + e.message, "#ef4444");
    }
}

async function reactivarLink(id) {
    const dias = parseInt(document.getElementById("dias-react-" + id)?.value || 15);
    try {
        const res  = await fetch("/reactivate-catalog", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dias, _pass: ADMIN_PASS })
        });
        const json = await res.json();
        if (json.ok) {
            toast("✅ Link reactivado por " + dias + " días", "#22c55e");
            cargarHistorialLinks();
        } else {
            toast("❌ " + (json.error || "Error al reactivar"), "#ef4444");
        }
    } catch(e) {
        toast("❌ " + e.message, "#ef4444");
    }
}

function getNotaEspecial(p) {
    // "caracterEspecial" (con "er") es el nombre real que usa Consignación/el worker.
    const v = p.caracterEspecial || p.caractEspecial || p.caract_especial || p.caracteristicaEspecial
           || p.caracteristica_especial || p.notaEspecial || p.nota_especial
           || p.caract || p.nota || p.etiqueta || "";
    return String(v).trim();
}

// Cuando hay un filtro de Talla activo, el catálogo exportado (Link/PDF/Imagen)
// debe mostrar SOLO esas tallas en la tarjeta — no todas las que el diseño
// tiene en stock. Admite varias tallas a la vez ("6.5,7"), no solo una — el
// cliente puede necesitar ver más de una talla en el mismo link.
function _sizesParaExport(p, tallaCsv, genero) {
    const catKey = p._catKey || getCatKey(p);
    const tallas = (tallaCsv || "").split(",").filter(Boolean);
    if (catKey !== "AN" || !tallas.length) {
        return { sizes: p._sizes||[], sizesD: p._sizesD||[], sizesH: p._sizesH||[] };
    }
    const interD = (p._sizesD||[]).filter(s => tallas.includes(s));
    const interH = (p._sizesH||[]).filter(s => tallas.includes(s));
    if (interD.length || interH.length) {
        return {
            sizes:  [],
            sizesD: genero === "caballero" ? [] : interD,
            sizesH: genero === "dama"      ? [] : interH,
        };
    }
    const inter = (p._sizes||[]).filter(s => tallas.includes(s));
    return { sizes: inter.length ? inter : (p._sizes||[]), sizesD: [], sizesH: [] };
}

async function generarLinkCatalogo() {
    const codsSel=[...document.querySelectorAll(".cat-chk:checked")].map(c=>c.dataset.cod);
    if(!codsSel.length) return toast("⚠️ Selecciona al menos un producto","#f97316");

    // _catFiltrada already has grouped AN products — no second grouping needed
    const lista      = _catFiltrada.filter(p=>codsSel.includes(p._codigos?.[0]||p.codigo));
    const esAfiliado = document.getElementById("cat-es-afiliado")?.checked||false;
    // Catálogo bilingüe para EE. UU. (envío DHL por monto de compra, formulario
    // de dirección estructurado) — solo aplica en la pestaña Cliente, nunca
    // Afiliado (ver adminverex/catalogo-us.html).
    const esUS = !esAfiliado && (document.getElementById("cat-es-us")?.checked || false);
    const nombre     = esAfiliado
        ? (document.getElementById("cat-afiliado-nombre")?.value||"").trim()
        : document.getElementById("cat-nombre").value.trim();
    const talla      = document.getElementById("cat-talla").value;
    const genero     = document.getElementById("cat-genero")?.value || "";
    const dias       = parseInt(document.getElementById("cat-validez").value)||3;
    const notaInterna = (document.getElementById("cat-nota-interna")?.value || "").trim();
    // Defensa adicional: en catálogo de Cliente, el número SIEMPRE es el
    // oficial de VEREX, sin importar qué haya quedado en el campo/localStorage
    // — nunca debe poder colarse el número de un afiliado por error.
    const wa         = esAfiliado
        ? (document.getElementById("cat-wa")?.value||localStorage.getItem("verex-wa")||"").trim()
        : VEREX_WA_OFICIAL;
    const afiliadoId = (document.getElementById("cat-afiliado-id")?.value||"").trim();
    const afiliadoCodigo = (document.getElementById("cat-afiliado-codigo")?.value||"").trim();

    if (esAfiliado && !afiliadoCodigo) {
        return toast("⚠️ Selecciona un afiliado de la lista (Consignación → Vendedores) para poder rastrear sus Leads y comisión", "#f97316");
    }

    // El banner no debe anunciar una promo que este link no tiene.
    if (!esAfiliado && !esUS && !_editandoLinkId) {
        const incoh = _wzIncoherenciasBanner();
        if (incoh.length && !confirm(`⚠️ El banner dice «${(document.getElementById("cat-banner-txt")?.value || "").trim()}» y menciona ${incoh.join("; ")}.\n\nEl cliente vería una oferta que este link no tiene.\n\nAceptar = crear el link igual\nCancelar = volver para corregir el banner`)) {
            wzEditarBanner();
            return;
        }
    }

    // No generar el catálogo de un afiliado que todavía no tiene contrato
    // firmado (ni digital ni en papel) — evita operar sin el acuerdo firmado.
    if (esAfiliado && afiliadoCodigo) {
        const v = _vendedoresAfiliados.find(x => x.codigo === afiliadoCodigo);
        if (v && !v.firmaContrato && !v.firmadoFisico) {
            return toast("⚠️ Este afiliado no tiene contrato firmado — firma el contrato (digital o en papel) en Consignación antes de generar su catálogo", "#ef4444");
        }
    }

    const btn=document.getElementById("btn-gen-link");
    btn.textContent="⏳..."; btn.disabled=true;

    try {
        // Banner / % descuento: nunca aplica a catálogos de afiliado — ellos ganan
        // comisión por venta y un descuento no acordado les afectaría esa comisión.
        // Tampoco aplica al catálogo de EE. UU. — su propio envío por tramos de
        // monto (DHL) y su formulario de dirección reemplazan estos incentivos.
        const bannerTxt = (esAfiliado || esUS) ? "" : (document.getElementById("cat-banner-txt")?.value||"").trim();
        const bannerSub = (esAfiliado || esUS) ? "" : (document.getElementById("cat-banner-sub")?.value||"").trim();
        const descPctRaw = (esAfiliado || esUS) ? 0 : Math.min(90, Math.max(0, parseInt(document.getElementById("cat-banner-desc-pct")?.value) || 0));
        // El cliente siempre debe ver el contexto de la oferta junto al precio ya
        // rebajado: si hay % de descuento sin banner, se pone uno automático.
        const banner = bannerTxt ? { txt: bannerTxt, sub: bannerSub, color: _bannerColor }
            : (descPctRaw > 0 ? { txt: _textoBannerDescuento(descPctRaw), sub: bannerSub, color: _bannerColor } : null);
        const descPct = banner ? descPctRaw : 0;
        // Igual que el % de descuento: solo aplica a Cliente doméstico.
        const promoCarrito = (esAfiliado || esUS) ? null : _leerPromoCarritoUI();
        const envioGratisDesde = (esAfiliado || esUS) ? 0 : (parseFloat(document.getElementById("cat-envio-gratis-desde")?.value) || 0);
        const regaloMonto = (esAfiliado || esUS) ? 0 : (parseFloat(document.getElementById("cat-regalo-monto")?.value) || 0);
        const regaloTexto = (esAfiliado || esUS) ? "" : (document.getElementById("cat-regalo-texto")?.value || "").trim();
        const regaloSorpresa = (regaloMonto > 0 && regaloTexto) ? { monto: regaloMonto, texto: regaloTexto } : null;

        // Para híbridos: excluir productos que ya tienen asignados físicamente en consignación
        let listaFinal = lista;
        if (esAfiliado && afiliadoCodigo) {
            const vHib = _vendedoresAfiliados.find(x => x.codigo === afiliadoCodigo);
            if (vHib?.tipo === "hibrido") {
                try {
                    const rFis = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "GET_CODIGOS_FISICOS", vendedor: afiliadoCodigo, _pass: ADMIN_PASS }) });
                    const { codigos: codsFis = [] } = await rFis.json();
                    if (codsFis.length) {
                        listaFinal = lista.filter(p => !codsFis.includes(p._codigos?.[0] || p.codigo));
                        if (listaFinal.length < lista.length)
                            toast(`ℹ️ ${lista.length - listaFinal.length} producto(s) excluidos del catálogo (ya los tiene físicamente)`, "#0277bd");
                    }
                } catch(_) {}
            }
        }

        // Receta de generación — se guarda también en el catálogo (KV), no
        // solo en localStorage, para que "Reactivar" desde la pestaña Links
        // pueda regenerar con stock actual sin importar en qué dispositivo
        // se abra (antes solo funcionaba en el navegador donde se creó).
        const _recetaCatsGen = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);
        const receta = {
            categorias: _recetaCatsGen,
            ocasiones: ocasionesSeleccionadas(),
            talla, genero,
            tipoAN: document.getElementById("cat-tipo-an")?.value || "",
            cantidad: codsSel.length,
            wa, esAfiliado, afiliadoCodigo,
            ultimosCodigos: codsSel
        };

        const data={
            expiry: Date.now()+dias*864e5,
            nombre, talla, wa, banner, dias, receta,
            ...(notaInterna && { nota_interna: notaInterna }),
            ...(descPct > 0 && { descPct }),
            ...(promoCarrito && { promoCarrito }),
            ...(envioGratisDesde > 0 && { envioGratisDesde }),
            ...(regaloSorpresa && { regaloSorpresa }),
            ...(esAfiliado && { afiliado: true }),
            ...(esUS && { tipoCatalogo: "us" }),
            ...(afiliadoId && { customId: afiliadoId }),
            ...(afiliadoCodigo && { afiliadoCodigo }),
            prods: listaFinal.map(p=>{
                const szExport = _sizesParaExport(p, talla, genero);
                return {
                n: p.nombre||"—",
                p: parseFloat(p.precio||0).toFixed(2),
                i: p.foto||p.img||"",
                m: p.material||detectarMaterial(p.nombre)||"",
                cat: p._catKey||getCatKey(p),
                c: p._codigos?.[0] || p.codigo || "",
                sizes:  szExport.sizes,
                sizesD: szExport.sizesD,
                sizesH: szExport.sizesH,
                // "par" solo es true si de verdad se detectaron piezas dama Y caballero
                // con precio propio cada una — eso dispara el cálculo del precio total.
                par:    p._esPareja || false,
                piezas: p._piezas || (p._esPareja ? 2 : null),
                pD:    p._precioDama||null,
                pH:    p._precioCab||null,
                cD:    p._piezasCodigosDama||null,
                cC:    p._piezasCodigosCab||null,
                // Aviso "Precio por pieza" — independiente de "par": las alianzas
                // suelen fotografiarse en pareja aunque se vendan como una sola pieza
                // a precio unisex, así que igual hay que aclarar que el precio es de
                // una sola de las que se ven en la foto.
                avisoPieza: /matrimonio|argolla|novios|pareja|alianza/i.test(p.nombre||""),
                ne:    getNotaEspecial(p),
                nota: (document.querySelector(`.cat-nota[data-cod="${p._codigos?.[0]||p.codigo}"]`)?.value||"").trim()
                };
            })
        };

        // Solo se recuerda el número para el próximo catálogo de AFILIADO
        // (conveniencia si generas varios seguidos para el mismo afiliado) —
        // nunca para Cliente, que siempre debe ser el oficial de VEREX.
        if(esAfiliado && wa) localStorage.setItem("verex-wa", wa);

        // Save to KV and get short URL
        const saveRes = await fetch("/save-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, _pass: ADMIN_PASS })
        });

        let finalUrl;
        if(saveRes.ok){
            const { url } = await saveRes.json();
            finalUrl = location.origin + url;
        } else {
            throw new Error("Error al guardar catálogo");
        }

        try { await navigator.clipboard.writeText(finalUrl); } catch(_){}
        document.getElementById("cat-link-out").textContent=finalUrl;
        document.getElementById("cat-link-out").href=finalUrl;
        document.getElementById("cat-link-box").style.display="block";
        toast("🔗 Link listo y copiado — pégalo en el navegador para verlo","#22c55e");
        guardarEnLogCatalogos({
            url: finalUrl,
            nombre,
            nota: notaInterna,
            filtros: capturarFiltrosCatalogo(),
            expiry: Date.now() + dias * 864e5,
            esAfiliado,
            afiliadoCodigo: afiliadoCodigo || "",
            receta: {
                ...receta,
                ultimosCodigos: codsSel
            }
        });
        renderLogCatalogos();
        if (document.getElementById("lk-lista")) cargarPanelLinks();

        // Guardar los criterios usados y los códigos mostrados — permite
        // "Refrescar" este mismo catálogo más adelante con stock actualizado
        // y priorizando variedad (evitar repetir lo mismo del mes pasado).
        if (esAfiliado && afiliadoCodigo) {
            const cats = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);
            const receta = { categorias: cats, ocasiones: ocasionesSeleccionadas(), talla, genero, tipoAN: document.getElementById("cat-tipo-an")?.value || "", cantidad: codsSel.length, ultimosCodigos: codsSel };
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GUARDAR_RECETA_CATALOGO", _pass: ADMIN_PASS, vendedor: afiliadoCodigo, receta }) }).catch(()=>{});
            // Registro global: marca estos códigos como "recién mostrados" para que
            // el próximo afiliado que se genere un catálogo reciba otra variedad.
            fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"REGISTRAR_VARIEDAD_CATALOGO_GLOBAL", _pass: ADMIN_PASS, codigos: codsSel }) }).catch(()=>{});
            if (_variedadGlobalCache) { const ts = Date.now(); codsSel.forEach(c => { _variedadGlobalCache[c] = ts; }); }
        }

    } catch(e){ console.error(e); toast("❌ Error al generar link: "+e.message,"#ef4444"); }
    finally { btn.textContent="🔗 Crear link"; btn.disabled=false; }
}

// ── Catálogos: log, captura de filtros, render y reactivar ─────────────

const CAT_LOG_KEY = "verex-cat-log";

function capturarFiltrosCatalogo() {
    const chips = [];
    const cats = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);
    const catLabels = { AN:"Anillos", PU:"Pulseras", CD:"Cadenas", AR:"Aretes", CJ:"Conjuntos", DR:"Dijes", AL:"Alianzas", AC:"Accesorios" };
    cats.forEach(k => chips.push(catLabels[k] || k));
    const tallas = (document.getElementById("cat-talla")?.value || "").split(",").filter(Boolean);
    tallas.forEach(t => chips.push("T" + t));
    const genero = document.getElementById("cat-genero")?.value;
    if (genero === "dama") chips.push("Dama");
    else if (genero === "caballero") chips.push("Caballero");
    const tipoAN = document.getElementById("cat-tipo-an")?.value;
    if (tipoAN === "pareja") chips.push("Argollas / Pareja");
    else if (tipoAN === "sencillo") chips.push("Sencillos");
    return chips;
}

function guardarEnLogCatalogos({ url, nombre, nota, filtros, expiry, esAfiliado, receta, afiliadoCodigo }) {
    const log = JSON.parse(localStorage.getItem(CAT_LOG_KEY) || "[]");
    const id = url.split("/").pop();
    const idx = log.findIndex(e => e.id === id);
    const entry = { id, url, nombre: nombre || "Sin nombre", nota: nota || "", filtros: filtros || [], expiry, esAfiliado: !!esAfiliado, createdAt: Date.now(), ...(receta && { receta }), ...(afiliadoCodigo && { afiliadoCodigo }) };
    if (idx >= 0) log[idx] = entry; else log.unshift(entry);
    localStorage.setItem(CAT_LOG_KEY, JSON.stringify(log.slice(0, 50)));
}

function renderLogCatalogos() {
    const wrap = document.getElementById("cat-log-lista");
    if (!wrap) return;
    const log = JSON.parse(localStorage.getItem(CAT_LOG_KEY) || "[]");
    if (!log.length) { wrap.innerHTML = '<p style="font-size:12px;color:#9ca3af;text-align:center;margin:10px 0;">Aún no hay catálogos generados.</p>'; return; }
    const now = Date.now();
    wrap.innerHTML = log.map(e => {
        const activo = e.expiry > now;
        const fechaVence = new Date(e.expiry).toLocaleDateString("es-SV", { day:"numeric", month:"short" });
        const statusHtml = activo
            ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;border-radius:20px;padding:3px 9px;font-size:11px;font-weight:600;">● Activo · vence ${fechaVence}</span>`
            : `<span style="display:inline-flex;align-items:center;gap:4px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;border-radius:20px;padding:3px 9px;font-size:11px;font-weight:600;">✕ Vencido ${fechaVence}</span>`;
        const chips = (e.filtros || []).map(f => `<span style="display:inline-flex;align-items:center;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:20px;padding:3px 9px;font-size:11px;">${f}</span>`).join("");
        const notaHtml = e.nota ? `<div style="font-size:12px;color:#6b7280;font-style:italic;margin-bottom:7px;">"${e.nota}"</div>` : "";
        const acciones = activo
            ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                <button onclick="navigator.clipboard.writeText('${e.url}');toast('✅ Link copiado','#22c55e')" style="flex:1;background:#f0fdf4;color:#166534;border:1px solid #a7f3d0;padding:6px 10px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">📋 Copiar link</button>
                <button onclick="window.open('${e.url}','_blank')" style="background:#f9fafb;color:#374151;border:1px solid #e5e7eb;padding:6px 10px;border-radius:7px;font-size:12px;cursor:pointer;">👁️ Ver</button>
               </div>`
            : `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:7px;padding:8px 10px;">
                <span style="font-size:12px;color:#92400e;flex:1;">Nuevo link hasta:</span>
                <input type="date" id="reac-fecha-${e.id}" style="font-size:12px;background:#fff;border:1px solid #fcd34d;border-radius:6px;padding:4px 8px;color:#111;" min="${new Date().toISOString().split('T')[0]}">
                <button onclick="clonarCatalogo('${e.id}','${e.nombre||''}')" style="background:#B8860B;color:#fff;border:none;padding:6px 12px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">🔗 Nuevo link</button>
               </div>`;
        return `<div style="background:#ffffff;border:1px solid ${activo ? '#d1fae5' : '#fee2e2'};border-radius:10px;padding:12px 14px;margin-bottom:8px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:600;color:#111827;">${e.nombre || "(Sin nombre)"} ${e.esAfiliado ? '<span style="font-size:10px;color:#065f46;background:#dcfce7;padding:2px 6px;border-radius:4px;">Afiliado</span>' : ''}</span>
                ${statusHtml}
            </div>
            ${notaHtml}
            ${chips ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">${chips}</div>` : ""}
            <div id="views-${e.id}" style="font-size:11px;color:#9ca3af;margin-bottom:2px;">👁️ cargando vistas…</div>
            ${e.esAfiliado && e.afiliadoCodigo ? `<div id="views-total-${e.afiliadoCodigo}" style="font-size:11px;color:#6b7280;margin-bottom:4px;"></div>` : '<div style="margin-bottom:4px;"></div>'}
            ${acciones}
        </div>`;
    }).join("");

    // Cargar vistas en background sin bloquear el render
    _cargarVistasCatalogos(log.map(e => e.id));
}


async function _cargarVistasCatalogos(ids) {
    try {
        const res = await fetch("/catalog-views", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, _pass: ADMIN_PASS })
        });
        if (!res.ok) return;
        const { views } = await res.json();
        const log = JSON.parse(localStorage.getItem(CAT_LOG_KEY) || "[]");

        // Actualizar vistas individuales por catálogo
        ids.forEach(id => {
            const el = document.getElementById("views-" + id);
            if (!el) return;
            const v = views[id];
            if (!v || !v.count) { el.textContent = "👁️ Sin aperturas aún"; return; }
            const ultima = v.last ? _tiempoRelativo(v.last) : "—";
            const primera = v.first ? new Date(v.first).toLocaleDateString("es-SV", { day:"numeric", month:"short" }) : "—";
            el.innerHTML = `👁️ <b style="color:#374151">${v.count}</b> ${v.count === 1 ? "apertura" : "aperturas"} · primera: ${primera} · última: ${ultima}`;
        });

        // Calcular y mostrar totales acumulados por afiliado
        const porAfiliado = new Map();
        log.forEach(e => {
            if (!e.esAfiliado || !e.afiliadoCodigo) return;
            const v = views[e.id];
            if (!porAfiliado.has(e.afiliadoCodigo)) porAfiliado.set(e.afiliadoCodigo, { total: 0, catalogos: 0, ultima: null });
            const agg = porAfiliado.get(e.afiliadoCodigo);
            agg.catalogos++;
            if (v) {
                agg.total += v.count || 0;
                if (!agg.ultima || (v.last && v.last > agg.ultima)) agg.ultima = v.last;
            }
        });
        porAfiliado.forEach((agg, codigo) => {
            const el = document.getElementById("views-total-" + codigo);
            if (!el) return;
            if (!agg.total) { el.textContent = ""; return; }
            const ultima = agg.ultima ? _tiempoRelativo(agg.ultima) : "—";
            el.innerHTML = `📊 Total afiliado: <b style="color:#374151">${agg.total}</b> vistas en ${agg.catalogos} catálogo${agg.catalogos !== 1 ? "s" : ""} · última: ${ultima}`;
        });
    } catch(_) {
        document.querySelectorAll('[id^="views-"]').forEach(el => el.textContent = "");
    }
}

function _tiempoRelativo(ts) {
    const diff = Date.now() - ts;
    const min  = Math.floor(diff / 60000);
    const hrs  = Math.floor(diff / 3600000);
    const dias = Math.floor(diff / 86400000);
    if (min < 2)   return "ahora mismo";
    if (min < 60)  return `hace ${min} min`;
    if (hrs < 24)  return `hace ${hrs}h`;
    if (dias < 7)  return `hace ${dias} día${dias > 1 ? "s" : ""}`;
    return new Date(ts).toLocaleDateString("es-SV", { day:"numeric", month:"short" });
}
