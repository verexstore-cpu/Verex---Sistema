// Admin VEREX — Catálogo para cliente: ocasiones (15 años, compromiso…)
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  CATÁLOGO PARA CLIENTE
// ═════════════════════════════════════════════
let _catFiltrada = [];

const CAT_MAP = {
    AN: "💍 Anillos",
    AR: "👂 Aretes",
    CD: "⛓️ Cadenas",
    PL: "💪 Pulseras",
    CN: "✨ Conjuntos",
    RL: "⌚ Relojes",
    OT: "📦 Otros",
};

// ═════════════════════════════════════════════
//  OCASIONES (15 años, compromiso, caballero…)
// ═════════════════════════════════════════════
// Etiquetas INTERNAS guardadas en cada fila del Stock (campo `ocasiones`, lista
// de ids) para armar catálogos de cliente sin buscar en todo el inventario.
// El cliente no las ve: el Worker las quita de GET_CATALOGO y los links /c/
// no las exportan. La lista editable vive en config.ocasiones; si nunca se ha
// guardado, se usa OCASIONES_DEFAULT. Ocultar una ocasión no borra las
// etiquetas de los productos — solo deja de mostrarse en los filtros.
const OCASIONES_DEFAULT = [
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

// Palabras con las que "Armar con IA" reconoce cada ocasión de la lista
// inicial. Las ocasiones nuevas se reconocen por su nombre.
const OCASIONES_PALABRAS = {
    "15anos":       /\b15 anos\b|\bquince\b|quinceaner|\bxv\b/,
    "compromiso":   /compromiso|pedida de mano/,
    "matrimonio":   /matrimonio|\bboda\b/,
    "caballero":    /caballero|hombre|para el\b/,
    "graduacion":   /graduacion|graduad/,
    "dia-madre":    /dia de la madre|\bmama\b|\bmadre\b/,
    "san-valentin": /valentin|14 de febrero|enamorad/,
    "religioso":    /bautizo|comunion|confirmacion|religios/,
    "navidad":      /navidad|navideno/,
    "bebe":         /\bbebe\b|\bnina\b|infantil/,
};

function ocasionesLista(incluirOcultas = false) {
    const l = (Array.isArray(cfg.ocasiones) && cfg.ocasiones.length) ? cfg.ocasiones : OCASIONES_DEFAULT;
    return incluirOcultas ? l : l.filter(o => !o.oculta);
}

function _normTxt(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Código base del diseño (sin sufijo de talla) — mismo criterio que el Worker
// (_baseTrio) para que "un diseño" signifique lo mismo en los dos lados. La 2da pieza de dama de un trío (ANL106B…)
// es parte del mismo diseño (ANL106), como en el Hub y en las tiendas.
function _baseDiseno(p) {
    return String(p.codigoBase || String(p.codigo || "").replace(/[DCU]?T\d+(\.\d+)?$/i, "") || p.codigo || "").toUpperCase().replace(/^(.+\d)B$/, "$1");
}

function _ocasionesDeFila(p) {
    return Array.isArray(p?.ocasiones) ? p.ocasiones : [];
}

// Para un producto agrupado (anillo con varias tallas) junta las ocasiones de todas sus filas.
function ocasionesDeProd(p) {
    if (Array.isArray(p._codigos) && p._codigos.length > 1) {
        const s = new Set();
        p._codigos.forEach(c => _ocasionesDeFila(productos.find(x => x.codigo === c)).forEach(o => s.add(o)));
        return [...s];
    }
    return _ocasionesDeFila(p);
}

function _ocasionTieneProductos(id) {
    return productos.some(p => _ocasionesDeFila(p).includes(id));
}

function ocasionesSeleccionadas() {
    return [...document.querySelectorAll(".cat-ocasion-chk:checked")].map(c => c.value);
}

function poblarOcasionesPills(seleccion = []) {
    const cont = document.getElementById("cat-ocasion-pills");
    const cont0 = document.getElementById("cat-ocasion-pills-0");
    if (!cont) return;
    // Cuántos diseños con stock en bodega tiene cada ocasión — ayuda a ver
    // de un vistazo qué falta por etiquetar.
    const conteo = _wzConteoDisenos(() => true, p => _ocasionesDeFila(p));
    const tarjeta = o => {
        const n = conteo[o.id] || 0;
        return `<label class="wz-card"><input type="checkbox" class="cat-ocasion-chk" value="${esc(o.id)}" ${seleccion.includes(o.id) ? "checked" : ""} onchange="onOcasionPillChange()">
            <span class="ic">${esc(o.emoji || "🏷️")}</span><span class="nm">${esc(o.nombre)}</span><span class="ct">${n} pieza${n === 1 ? "" : "s"}</span></label>`;
    };
    const lista = ocasionesLista();
    const conPiezas = lista.filter(o => conteo[o.id] || seleccion.includes(o.id));
    const sinPiezas = lista.filter(o => !conPiezas.includes(o));
    cont.innerHTML = conPiezas.map(tarjeta).join("")
        || `<div style="font-size:12.5px;color:#888;grid-column:1/-1;">Aún no hay productos etiquetados — usa 🏷️ Etiquetar productos.</div>`;
    if (cont0) cont0.innerHTML = sinPiezas.map(tarjeta).join("");
    const wrap0 = document.getElementById("wz-ocasiones-0-wrap");
    if (wrap0) wrap0.hidden = !sinPiezas.length;
}

function onOcasionPillChange() {
    // La tarjeta marcada se pinta sola por CSS (.wz-card:has(input:checked)).
    poblarCategorias();   // los números de cada tipo de pieza dependen de la ocasión
    filtrarParaCatalogo();
}

// ── Modo rápido: etiquetar tocando fotos ─────────────────────────
// Cambios pendientes: "ocasion|BASE" → true (agregar) / false (quitar).
let _etqPendientes = new Map();

function _disenosParaEtiquetar() {
    const map = new Map();
    productos.forEach(p => {
        if (p.estado === "inactivo") return;
        const base = _baseDiseno(p);
        if (!map.has(base)) map.set(base, { base, codigo: p.codigo, nombre: p.nombre_base || p.nombre || "", foto: p.fotoMejorada || p.foto || p.img || "", cat: getCatKey(p), filas: [] });
        map.get(base).filas.push(p);
    });
    return [...map.values()];
}

function _disenoTieneOcasion(d, id) {
    const k = id + "|" + d.base;
    if (_etqPendientes.has(k)) return _etqPendientes.get(k);
    return d.filas.some(f => _ocasionesDeFila(f).includes(id));
}

function abrirEtiquetarOcasiones() {
    _etqPendientes = new Map();
    const selOc = document.getElementById("etq-ocasion");
    const elegidas = ocasionesSeleccionadas();
    selOc.innerHTML = ocasionesLista().map(o => `<option value="${esc(o.id)}">${esc(o.emoji || "")} ${esc(o.nombre)}</option>`).join("");
    if (elegidas.length) selOc.value = elegidas[0];
    const selCat = document.getElementById("etq-categoria");
    const presentes = [...new Set(productos.map(p => getCatKey(p)))];
    selCat.innerHTML = `<option value="">Todas las categorías</option>` +
        Object.keys(CAT_MAP).filter(k => presentes.includes(k)).map(k => `<option value="${k}">${CAT_MAP[k]}</option>`).join("");
    document.getElementById("etq-buscar").value = "";
    document.getElementById("modal-etq-ocasion").classList.add("open");
    renderEtiquetarOcasiones();
}

function cerrarEtiquetarOcasiones() {
    if (_etqPendientes.size && !confirm(`Tienes ${_etqPendientes.size} cambio(s) sin guardar. ¿Cerrar sin guardar?`)) return;
    _etqPendientes = new Map();
    document.getElementById("modal-etq-ocasion").classList.remove("open");
}

function renderEtiquetarOcasiones() {
    const id      = document.getElementById("etq-ocasion").value;
    const cat     = document.getElementById("etq-categoria").value;
    const mostrar = document.getElementById("etq-mostrar").value;
    const q       = _normTxt(document.getElementById("etq-buscar").value.trim());
    const soloStock = document.getElementById("etq-solo-stock").checked;
    let lista = _disenosParaEtiquetar();
    if (cat)       lista = lista.filter(d => d.cat === cat);
    if (soloStock) lista = lista.filter(d => d.filas.some(f => _stockTotalProd(f) > 0));
    if (q)         lista = lista.filter(d => _normTxt(d.nombre).includes(q) || _normTxt(d.base).includes(q));
    if (mostrar === "sin") lista = lista.filter(d => !d.filas.some(f => _ocasionesDeFila(f).length));
    if (mostrar === "con") lista = lista.filter(d => d.filas.some(f => _ocasionesDeFila(f).includes(id)));
    lista.sort((a, b) => a.cat.localeCompare(b.cat) || a.nombre.localeCompare(b.nombre));

    const marcados = lista.filter(d => _disenoTieneOcasion(d, id)).length;
    document.getElementById("etq-info").textContent = `${lista.length} diseño(s) · ${marcados} marcado(s) con esta ocasión. Toca una foto para marcarla o desmarcarla.`;
    const grid = document.getElementById("etq-grid");
    if (!lista.length) { grid.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:20px;">No hay productos con ese filtro.</p>'; _actualizarPendientesEtq(); return; }
    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">${lista.map(d => {
        const on = _disenoTieneOcasion(d, id);
        const pend = _etqPendientes.has(id + "|" + d.base);
        const otras = [...new Set(d.filas.flatMap(_ocasionesDeFila))].filter(o => o !== id)
            .map(o => ocasionesLista(true).find(x => x.id === o)?.emoji || "").join("");
        const img = d.foto ? ikSharp(d.foto) : "";
        return `<div data-base="${esc(d.base)}" onclick="toggleEtqDiseno(this.dataset.base)" style="cursor:pointer;border-radius:10px;overflow:hidden;border:3px solid ${on ? "#C9A84C" : "transparent"};background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12);position:relative;">
            <div style="aspect-ratio:1/1;background:#f5f5f5;">
                ${img ? `<img src="${img}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;${on ? "" : "opacity:.85;"}" onerror="this.style.display='none'">` : `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:30px;color:#ccc;">💍</div>`}
            </div>
            <div style="position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:${on ? "#C9A84C" : "rgba(255,255,255,.9)"};border:1.5px solid ${on ? "#C9A84C" : "#ccc"};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#000;">${on ? "✓" : ""}</div>
            ${pend ? `<div style="position:absolute;top:6px;left:6px;background:#f97316;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:8px;">SIN GUARDAR</div>` : ""}
            <div style="padding:5px 7px;">
                <div style="font-size:11px;font-weight:700;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(d.nombre || "—")}</div>
                <div style="font-size:10px;color:#888;display:flex;justify-content:space-between;gap:4px;"><span>${esc(d.base)}</span><span title="Otras ocasiones">${otras}</span></div>
            </div>
        </div>`;
    }).join("")}</div>`;
    _actualizarPendientesEtq();
}

function toggleEtqDiseno(base) {
    const id = document.getElementById("etq-ocasion").value;
    const d = _disenosParaEtiquetar().find(x => x.base === base);
    if (!d || !id) return;
    const k = id + "|" + base;
    const original = d.filas.some(f => _ocasionesDeFila(f).includes(id));
    const nuevo = !_disenoTieneOcasion(d, id);
    if (nuevo === original) _etqPendientes.delete(k); else _etqPendientes.set(k, nuevo);
    renderEtiquetarOcasiones();
}

function _actualizarPendientesEtq() {
    const n = _etqPendientes.size;
    document.getElementById("etq-pendientes").textContent = n ? `${n} cambio(s) sin guardar` : "";
    document.getElementById("etq-guardar").disabled = !n;
}

async function guardarEtiquetasOcasion() {
    if (!_etqPendientes.size) return;
    const btn = document.getElementById("etq-guardar");
    btn.disabled = true; btn.textContent = "⏳ Guardando...";
    const disenos = new Map(_disenosParaEtiquetar().map(d => [d.base, d]));
    // Agrupar por (ocasión, agregar/quitar) → una llamada por cada 5 diseños (el Worker
    // tiene un límite de 50 subrequests por petición; ver STOCK_OCASIONES).
    const grupos = new Map();
    _etqPendientes.forEach((agregar, k) => {
        const [id, base] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
        const d = disenos.get(base);
        if (!d) return;
        const g = id + "|" + (agregar ? 1 : 0);
        if (!grupos.has(g)) grupos.set(g, { id, agregar, codigos: [] });
        grupos.get(g).codigos.push(d.codigo);
    });
    let ok = 0, fallos = 0;
    for (const g of grupos.values()) {
        for (let i = 0; i < g.codigos.length; i += 5) {
            const codigos = g.codigos.slice(i, i + 5);
            try {
                const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "STOCK_OCASIONES", _pass: ADMIN_PASS, codigos, [g.agregar ? "agregar" : "quitar"]: [g.id] }) }).then(x => x.json());
                if (!r?.ok) throw new Error(r?.error || "error");
                (r.actualizados || []).forEach(a => { const p = productos.find(x => x.codigo === a.codigo); if (p) p.ocasiones = a.ocasiones; });
                codigos.forEach(c => { const d = [...disenos.values()].find(x => x.codigo === c); if (d) _etqPendientes.delete(g.id + "|" + d.base); });
                ok += codigos.length;
            } catch (e) {
                console.error("[ocasiones]", e);
                fallos += codigos.length;
            }
        }
    }
    btn.textContent = "💾 Guardar";
    renderEtiquetarOcasiones();
    poblarOcasionesPills(ocasionesSeleccionadas());
    filtrarParaCatalogo();
    if (fallos) toast(`⚠️ ${ok} guardado(s), ${fallos} no se pudieron guardar — revisa que el Worker esté actualizado y vuelve a intentar`, "#f97316");
    else toast(`✅ ${ok} diseño(s) actualizados`, "#22c55e");
}

// ── Gestionar la lista de ocasiones ──────────────────────────────
let _gestOcasiones = [];

function abrirGestionOcasiones() {
    _gestOcasiones = ocasionesLista(true).map(o => ({ ...o }));
    renderGestionOcasiones();
    document.getElementById("modal-gest-ocasion").classList.add("open");
}

function cerrarGestionOcasiones() {
    document.getElementById("modal-gest-ocasion").classList.remove("open");
}

function renderGestionOcasiones() {
    document.getElementById("gest-ocasion-lista").innerHTML = _gestOcasiones.map((o, i) => `
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;${o.oculta ? "opacity:.5;" : ""}">
            <input type="text" value="${esc(o.emoji || "")}" maxlength="4" oninput="_gestOcasiones[${i}].emoji=this.value" style="width:52px;text-align:center;">
            <input type="text" value="${esc(o.nombre)}" maxlength="40" oninput="_gestOcasiones[${i}].nombre=this.value" style="flex:1;">
            <button type="button" onclick="_gestOcasiones[${i}].oculta=!_gestOcasiones[${i}].oculta;renderGestionOcasiones()"
                style="white-space:nowrap;background:#fff;border:1.5px solid var(--borde);border-radius:8px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;">${o.oculta ? "👁️ Mostrar" : "🙈 Ocultar"}</button>
        </div>`).join("");
}

function agregarFilaOcasion() {
    _gestOcasiones.push({ id: "", emoji: "🏷️", nombre: "" });
    renderGestionOcasiones();
    const inputs = document.querySelectorAll("#gest-ocasion-lista input[maxlength='40']");
    inputs[inputs.length - 1]?.focus();
}

async function guardarGestionOcasiones() {
    const usados = new Set();
    const lista = [];
    for (const o of _gestOcasiones) {
        const nombre = String(o.nombre || "").trim();
        if (!nombre) { if (o.id) return toast("⚠️ Una ocasión quedó sin nombre — escríbelo u ocúltala", "#f97316"); continue; }
        // El id se crea una sola vez a partir del nombre y no cambia al renombrar,
        // así los productos ya etiquetados conservan su ocasión.
        let id = o.id || _normTxt(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "ocasion";
        if (!o.id) { const raiz = id; let n = 2; while (usados.has(id) || ocasionesLista(true).some(x => x.id === id)) id = `${raiz}-${n++}`; }
        if (usados.has(id)) continue;
        usados.add(id);
        lista.push({ id, emoji: String(o.emoji || "").trim().slice(0, 4), nombre: nombre.slice(0, 40), ...(o.oculta && { oculta: true }) });
    }
    const btn = document.getElementById("gest-ocasion-guardar");
    btn.disabled = true; btn.textContent = "⏳...";
    try {
        const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "ACTUALIZAR_CONFIG", _pass: ADMIN_PASS, config: { ocasiones: lista } }) }).then(x => x.json());
        if (!r?.ok) throw new Error(r?.error || "error");
        cfg.ocasiones = lista;
        localStorage.setItem("vx_cfg", JSON.stringify(cfg));
        cerrarGestionOcasiones();
        poblarOcasionesPills(ocasionesSeleccionadas().filter(id => lista.some(o => o.id === id && !o.oculta)));
        filtrarParaCatalogo();
        toast("✅ Ocasiones guardadas", "#22c55e");
    } catch (e) {
        toast("❌ No se pudieron guardar las ocasiones", "#ef4444");
    } finally {
        btn.disabled = false; btn.textContent = "💾 Guardar";
    }
}
