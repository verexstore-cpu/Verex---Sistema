// Admin VEREX — Sugerir qué publicar (verexstore.com)
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  ✨ SUGERIR QUÉ PUBLICAR (verexstore.com)
// ═════════════════════════════════════════════
// Propone N piezas para publicar HOY, buscando variedad (tipo de pieza, precio y
// material), dando prioridad a la ocasión que se acerca, a lo nuevo y a lo que no
// se ha publicado hace tiempo; y propone quitar lo publicado que ya no se puede
// vender (sin stock en tienda/bodega o sin foto). Publica con STOCK_PUBLICAR_VISIBLE
// (solo cambia enCatalogo, no mueve inventario), igual que el Hub.
const SP_PROPS_DEF = { AN: 40, AR: 20, CD: 20, PL: 10, CN: 10, RL: 0, OT: 0 };
const SP_TEMPORADAS = [
    { meses: [10, 11, 12], mes: 12, dia: 25, ocasion: "navidad",      nombre: "Navidad" },
    { meses: [1, 2],       mes: 2,  dia: 14, ocasion: "san-valentin", nombre: "San Valentín" },
    { meses: [3, 4, 5],    mes: 5,  dia: 10, ocasion: "dia-madre",    nombre: "Día de la Madre" },
    { meses: [6],          mes: 6,  dia: 17, ocasion: "caballero",    nombre: "Día del Padre" },
];
const SP_TRAMOS = ["Hasta $20", "$20 – $35", "Más de $35"];
const SP_MATS = { plata: "Plata 925", "plata-oro": "Plata + Oro Lam.", acero: "Acero 316L", oro: "Oro", otro: "Otro" };
// Cuánto espacio se le da a cada material. «plata» = plata y laminado primero (por defecto).
const SP_MAT_MODOS = {
    plata:  { ic: "🥈", nm: "Plata y laminado primero", ct: "la mayoría plata 925 y plata + oro lam.", props: { plata: 50, "plata-oro": 40, acero: 10, oro: 0, otro: 0 } },
    equi:   { ic: "⚖️", nm: "Equilibrado", ct: "variedad pareja de materiales", props: null },
    manual: { ic: "✋", nm: "Manual", ct: "tú eliges el % de cada material", props: null },
};
let _spMatModo = "plata", _spMatProps = { ...SP_MAT_MODOS.plata.props };
let _spN = 10, _spOcasion = null, _spProps = null, _spAdd = [], _spDel = [], _spVistos = new Set();

function _spTramo(precio) { const p = parseFloat(precio) || 0; return p < 20 ? SP_TRAMOS[0] : p <= 35 ? SP_TRAMOS[1] : SP_TRAMOS[2]; }
function _spMaterial(p) {
    const m = (p.material || detectarMaterial(p.nombre) || "").toLowerCase();
    if (m.includes("plata") && (m.includes("oro") || m.includes("lam"))) return "plata-oro";
    if (m.includes("laminado")) return "plata-oro";
    if (m.includes("plata")) return "plata";
    if (m.includes("oro")) return "oro";
    if (m.includes("acero")) return "acero";
    return "otro";
}
function _spTemporada() {
    const hoy = new Date(), mes = hoy.getMonth() + 1;
    const t = SP_TEMPORADAS.find(x => x.meses.includes(mes));
    if (!t) return null;
    let fecha = new Date(hoy.getFullYear(), t.mes - 1, t.dia);
    if (fecha < hoy) fecha = new Date(hoy.getFullYear() + 1, t.mes - 1, t.dia);
    return { ...t, dias: Math.ceil((fecha - hoy) / 864e5) };
}

// Un «diseño» por código base (todas sus tallas juntas).
function _spDisenos() {
    const map = new Map();
    productos.forEach(p => {
        if (p.estado === "inactivo" || p.esPrueba) return;
        const base = _baseDiseno(p);
        if (!map.has(base)) map.set(base, { base, codigos: [], filas: [], nombre: p.nombre_base || p.nombre || "", foto: p.fotoMejorada || p.foto || p.img || "",
            cat: getCatKey(p), precio: parseFloat(p.precio) || 0, mat: _spMaterial(p), ocasiones: new Set(), stock: 0, publicado: false,
            reservado: false, registro: 0, publicadoEn: 0, despublicadoEn: 0 });
        const d = map.get(base);
        d.codigos.push(p.codigo); d.filas.push(p);
        if (!d.foto) d.foto = p.fotoMejorada || p.foto || p.img || "";
        _ocasionesDeFila(p).forEach(o => d.ocasiones.add(o));
        d.stock += (parseInt(p.stock_bodega) || 0) + (parseInt(p.stock_tienda) || 0);
        if (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") d.publicado = true;
        if (p.reservado) d.reservado = true;
        const t = k => Date.parse(p[k] || "") || 0;
        d.registro = Math.max(d.registro, t("fechaRegistro"));
        d.publicadoEn = Math.max(d.publicadoEn, t("publicadoEn"));
        d.despublicadoEn = Math.max(d.despublicadoEn, t("despublicadoEn"));
    });
    return [...map.values()];
}

function _spConteo(lista) {
    const c = { cat: {}, tramo: {}, mat: {} };
    lista.forEach(d => { c.cat[d.cat] = (c.cat[d.cat] || 0) + 1; c.tramo[_spTramo(d.precio)] = (c.tramo[_spTramo(d.precio)] || 0) + 1; c.mat[d.mat] = (c.mat[d.mat] || 0) + 1; });
    return c;
}

function abrirSugerirPublicar() {
    const g = cfg.sugerirPublicar || {};
    _spN = g.n || 10;
    _spProps = { ...SP_PROPS_DEF, ...(g.props || {}) };
    _spMatModo = SP_MAT_MODOS[g.matModo] ? g.matModo : "plata";
    _spMatProps = { ...SP_MAT_MODOS.plata.props, ...(_spMatModo === "manual" ? (g.matProps || {}) : {}) };
    const temp = _spTemporada();
    _spOcasion = temp && ocasionesLista().some(o => o.id === temp.ocasion) ? temp.ocasion : "";
    _spVistos = new Set();
    document.getElementById("modal-sugerir").classList.add("open");
    spSugerir();
}
function spMatModo(m) {
    _spMatModo = m;
    if (SP_MAT_MODOS[m].props) _spMatProps = { ...SP_MAT_MODOS[m].props };
    spSugerir();
}
// Proporción objetivo por material (null = equilibrado: solo variedad).
function _spMatObjetivo() {
    if (_spMatModo === "equi") return null;
    const t = Object.values(_spMatProps).reduce((a, b) => a + b, 0);
    return t ? _spMatProps : null;
}
function cerrarSugerirPublicar() { document.getElementById("modal-sugerir").classList.remove("open"); }

function spSugerir(otras = false) {
    const dis = _spDisenos();
    const pub = dis.filter(d => d.publicado);
    const quitar = document.getElementById("sp-c-quitar").checked;
    _spDel = quitar ? pub.filter(d => d.stock <= 0 || !d.foto).map(d => ({ ...d, on: true, why: [d.stock <= 0 ? "Agotado" : "Sin foto"] })) : [];
    const sale = new Set(_spDel.map(d => d.base));
    const quedan = pub.filter(d => !sale.has(d.base));
    if (otras) _spAdd.forEach(d => _spVistos.add(d.base));
    let cand = dis.filter(d => !d.publicado && !d.reservado && d.stock > 0 && d.foto);
    const sinVistos = cand.filter(d => !_spVistos.has(d.base));
    if (sinVistos.length >= Math.min(_spN, cand.length)) cand = sinVistos; else _spVistos = new Set();

    const nuevo = document.getElementById("sp-c-nuevo").checked, repetir = document.getElementById("sp-c-repetir").checked;
    const ahora = Date.now(), D = 864e5;
    const oc = _spOcasion ? ocasionesLista(true).find(o => o.id === _spOcasion) : null;
    const elegidas = [], disp = cand.slice();
    const cnt = _spConteo(quedan);
    const totalProps = Object.values(_spProps).reduce((a, b) => a + b, 0) || 1;
    let deOcasion = 0;
    while (elegidas.length < _spN && disp.length) {
        const total = quedan.length + elegidas.length + 1;
        // Con una ocasión elegida, hasta la mitad de las sugeridas son de esa ocasión
        // (repartidas por tipo de pieza); el resto se completa por variedad.
        const delOc = oc ? disp.filter(d => d.ocasiones.has(oc.id)) : [];
        const pool = (delOc.length && deOcasion < Math.ceil(_spN / 2)) ? delOc : disp;
        // Tipo de pieza con más «falta» respecto a la proporción deseada.
        const cats = [...new Set(pool.map(d => d.cat))];
        const falta = c => (_spProps[c] || 0) / totalProps * total - (cnt.cat[c] || 0);
        cats.sort((a, b) => falta(b) - falta(a) || Math.random() - .5);
        const cat = cats[0];
        const tramoMin = SP_TRAMOS.slice().sort((a, b) => (cnt.tramo[a] || 0) - (cnt.tramo[b] || 0))[0];
        const matsPres = Object.keys(SP_MATS).filter(m => m !== "otro" && disp.some(d => d.mat === m));
        const matObj = _spMatObjetivo();
        let matMin = null, faltaMat = null;
        if (matObj) {
            // Material con más «falta» respecto al % deseado (sobre toda la tienda).
            const tM = Object.values(matObj).reduce((a, b) => a + b, 0);
            faltaMat = m => (matObj[m] || 0) / tM * total - (cnt.mat[m] || 0);
            matMin = matsPres.filter(m => matObj[m] > 0).sort((a, b) => faltaMat(b) - faltaMat(a))[0] || null;
        } else matMin = matsPres.sort((a, b) => (cnt.mat[a] || 0) - (cnt.mat[b] || 0))[0];
        let mejor = null;
        pool.filter(d => d.cat === cat).forEach(d => {
            let s = Math.random() * 0.8; const why = [];
            if (falta(cat) >= 0.5) why.push(`Faltan ${(CAT_MAP[cat] || cat).replace(/^\S+\s/, "").toLowerCase()}`);
            if (oc && d.ocasiones.has(oc.id)) { s += 3; why.push(`${oc.emoji || ""} ${oc.nombre}`.trim()); }
            if (matObj) {
                if (!matObj[d.mat]) s -= 3;
                else if (d.mat === matMin) { s += 2.5; why.push(`Prioridad ${SP_MATS[d.mat].toLowerCase()}`); }
                else if (faltaMat(d.mat) > 0) s += 1.5;
                else s -= 1;
            } else if (d.mat === matMin) { s += 1; why.push(`Falta ${SP_MATS[d.mat].toLowerCase()}`); }
            if (nuevo && d.registro && ahora - d.registro < 30 * D) { s += 2; why.push("Nuevo"); }
            if (repetir) {
                if (!d.publicadoEn && !d.despublicadoEn) { s += 1; why.push("Nunca publicado"); }
                else if (d.despublicadoEn && ahora - d.despublicadoEn > 60 * D) { s += 1; why.push(`No se publica hace ${Math.round((ahora - d.despublicadoEn) / D)} días`); }
                else if (d.despublicadoEn && ahora - d.despublicadoEn < 14 * D) s -= 1.5;
            }
            if (_spTramo(d.precio) === tramoMin) { s += 1; why.push(`Falta ${tramoMin.toLowerCase()}`); }
            if (!mejor || s > mejor.s) mejor = { d, s, why };
        });
        if (oc && mejor.d.ocasiones.has(oc.id)) deOcasion++;
        // La ocasión va primero entre las razones, para que se vea por qué se eligió.
        const ocTxt = oc ? `${oc.emoji || ""} ${oc.nombre}`.trim() : "";
        const why = mejor.why.includes(ocTxt) ? [ocTxt, ...mejor.why.filter(w => w !== ocTxt)] : mejor.why;
        elegidas.push({ ...mejor.d, on: true, why: why.slice(0, 3) });
        disp.splice(disp.indexOf(mejor.d), 1);
        cnt.cat[cat] = (cnt.cat[cat] || 0) + 1;
        cnt.tramo[_spTramo(mejor.d.precio)] = (cnt.tramo[_spTramo(mejor.d.precio)] || 0) + 1;
        cnt.mat[mejor.d.mat] = (cnt.mat[mejor.d.mat] || 0) + 1;
    }
    _spAdd = elegidas;
    _spPintar(pub, cand.length);
}

// Tallas ya publicadas en la web (con fecha de publicación, o sea desde el sistema) que en Stock siguen en bodega:
// quedaron así porque antes publicar no movía el inventario. Se pasan a tienda igual que «Asignar a tienda» del Hub.
function _spPendientesTienda() {
    return productos.filter(p => p.estado !== "inactivo" && !p.esPrueba
        && (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") && p.publicadoEn
        && (parseInt(p.stock_bodega) || 0) > 0);
}
async function spPasarPendientesATienda() {
    const pend = _spPendientesTienda();
    if (!pend.length) return;
    const uds = pend.reduce((a, p) => a + (parseInt(p.stock_bodega) || 0), 0);
    if (!confirm(`¿Pasar a tienda en Stock las ${uds} unidad(es) que siguen en bodega de ${pend.length} talla(s) ya publicadas en la web?`)) return;
    const btn = document.getElementById("sp-pend-btn");
    btn.disabled = true; btn.textContent = "⏳ Moviendo…";
    let movidas = 0;
    try {
        const cods = pend.map(p => p.codigo);
        for (let i = 0; i < cods.length; i += 300) {
            const lote = cods.slice(i, i + 300);
            const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "STOCK_ASIGNAR_TIENDA", _pass: ADMIN_PASS, codigos: lote, cantidad: 100000 }) }).then(x => x.json()).catch(() => null);
            if (!r?.ok) throw new Error(r?.error || "sin respuesta del servidor");
            lote.forEach(c => { const p = productos.find(x => x.codigo === c); if (p) { p.stock_tienda = (parseInt(p.stock_tienda) || 0) + (parseInt(p.stock_bodega) || 0); p.stock_bodega = 0; p.estado = "tienda"; } });
            movidas += lote.length;
        }
        toast(`✅ ${uds} unidad(es) de ${movidas} talla(s) pasadas de bodega a tienda en Stock`, "#22c55e");
    } catch (e) {
        toast(`❌ ${movidas ? movidas + " movidas, pero " : ""}no se pudo terminar: ${e.message}`, "#ef4444");
    }
    btn.disabled = false; btn.textContent = "📦→🏪 Pasarlas a tienda";
    _spPintar();
}

function spToggle(tipo, i) { const l = tipo === "add" ? _spAdd : _spDel; l[i].on = !l[i].on; _spPintar(); }
function spTodo(tipo, v) { (tipo === "add" ? _spAdd : _spDel).forEach(d => d.on = v); _spPintar(); }

let _spPub = [], _spNCand = 0;
function _spPintar(pub, nCand) {
    if (pub) { _spPub = pub; _spNCand = nCand; }
    const $ = id => document.getElementById(id);
    $("sp-n").innerHTML = [5, 10, 15, 20, 30].map(v => `<button type="button" class="wz-card${_spN === v ? " on" : ""}" onclick="_spN=${v};spSugerir()"><span class="nm">${v}</span></button>`).join("")
        + `<label class="wz-card${[5, 10, 15, 20, 30].includes(_spN) ? "" : " on"}" style="cursor:text;"><span class="nm" style="font-size:12px;">Otro</span><input type="number" min="1" max="100" value="${[5, 10, 15, 20, 30].includes(_spN) ? "" : _spN}" placeholder="#" style="display:block !important;width:100%;padding:4px 6px !important;margin-top:2px;" onchange="_spN=Math.max(1,Math.min(100,parseInt(this.value)||10));spSugerir()"></label>`;
    const temp = _spTemporada();
    $("sp-temp-hint").textContent = temp ? `📅 ${temp.nombre} en ${temp.dias} días` : "";
    const conCand = id => _spDisenos().filter(d => !d.publicado && d.stock > 0 && d.foto && d.ocasiones.has(id)).length;
    $("sp-ocasion").innerHTML = `<button type="button" class="wz-card${!_spOcasion ? " on" : ""}" onclick="_spOcasion='';spSugerir()"><span class="ic">⚖️</span><span class="nm">Solo variedad</span><span class="ct">sin ocasión especial</span></button>`
        + ocasionesLista().map(o => { const n = conCand(o.id); return n || _spOcasion === o.id ? `<button type="button" class="wz-card${_spOcasion === o.id ? " on" : ""}" onclick="_spOcasion='${esc(o.id)}';spSugerir()"><span class="ic">${esc(o.emoji || "🏷️")}</span><span class="nm">${esc(o.nombre)}</span><span class="ct">${n} sin publicar${temp && temp.ocasion === o.id ? " · se acerca" : ""}</span></button>` : ""; }).join("");

    $("sp-mat").innerHTML = Object.entries(SP_MAT_MODOS).map(([k, m]) => `<button type="button" class="wz-card${_spMatModo === k ? " on" : ""}" onclick="spMatModo('${k}')"><span class="ic">${m.ic}</span><span class="nm">${m.nm}</span><span class="ct">${m.ct}</span></button>`).join("");
    const tMat = Object.values(_spMatProps).reduce((a, b) => a + b, 0);
    $("sp-mat-man").hidden = _spMatModo !== "manual";
    $("sp-mat-man").innerHTML = _spMatModo !== "manual" ? "" : Object.keys(SP_MATS).map(k => `<label class="sp-prop"><span>${SP_MATS[k]}</span>
        <input type="range" min="0" max="100" step="5" value="${_spMatProps[k] || 0}" oninput="_spMatProps['${k}']=+this.value;this.parentNode.querySelector('.v').textContent=this.value+'%'" onchange="spSugerir()"><span class="v">${_spMatProps[k] || 0}%</span></label>`).join("")
        + (tMat ? "" : `<div style="font-size:12px;color:#b45309;">Todo en 0 % → se reparte por variedad.</div>`);
    const tarjeta = (d, tipo, i) => `<button type="button" class="sp-prod ${tipo}${d.on ? " on" : ""}" onclick="spToggle('${tipo}',${i})">
        <div class="ph">${d.foto ? `<img src="${ikSharp(d.foto)}" loading="lazy" alt="" onerror="this.remove()">` : "💍"}</div>
        <span class="ck">${d.on ? (tipo === "add" ? "+ Publicar" : "− Quitar") : "No"}</span>
        <div class="bd"><span class="n">${esc(d.nombre || "—")}</span><span class="p">$${d.precio.toFixed(2)}</span>
        <span class="m">${(CAT_MAP[d.cat] || d.cat)} · ${SP_MATS[d.mat]} · ${esc(d.base)}</span>
        <span class="sp-why">${d.why.map(w => `<i>${esc(w)}</i>`).join("")}</span></div></button>`;
    $("sp-g-add").innerHTML = _spAdd.length ? _spAdd.map((d, i) => tarjeta(d, "add", i)).join("")
        : `<div style="grid-column:1/-1;color:#888;font-size:13px;padding:20px;text-align:center;border:1.5px dashed var(--borde);border-radius:12px;">No hay piezas sin publicar que tengan stock y foto.</div>`;
    $("sp-g-del").innerHTML = _spDel.map((d, i) => tarjeta(d, "del", i)).join("");
    $("sp-sec-del").hidden = !_spDel.length;

    const a = _spAdd.filter(d => d.on), q = _spDel.filter(d => d.on);
    const fin = _spPub.length + a.length - q.length;
    $("sp-k-pub").textContent = _spPub.length; $("sp-k-add").textContent = "+" + a.length; $("sp-k-del").textContent = "−" + q.length; $("sp-k-fin").textContent = fin;
    $("sp-s-add").textContent = `${a.length} de ${_spAdd.length} · de ${_spNCand} piezas que se pueden publicar · toca una para no incluirla`;
    $("sp-s-del").textContent = `${q.length} de ${_spDel.length} · toca una para dejarla publicada`;

    const salen = new Set(q.map(d => d.base));
    const hoyC = _spConteo(_spPub), nuevaC = _spConteo([..._spPub.filter(d => !salen.has(d.base)), ...a]);
    const filas = (el, claves, nombres, h, n) => {
        const tH = Object.values(h).reduce((x, y) => x + y, 0) || 1, tN = Object.values(n).reduce((x, y) => x + y, 0) || 1;
        $(el).innerHTML = claves.filter(k => h[k] || n[k]).map(k => { const x = Math.round((h[k] || 0) / tH * 100), y = Math.round((n[k] || 0) / tN * 100);
            return `<div class="sp-row"><span>${nombres(k)}</span><div class="sp-bars"><div class="sp-bar" style="width:${x}%"></div><div class="sp-bar n" style="width:${y}%"></div></div><span class="v">${x}% → <b style="color:#111;">${y}%</b></span></div>`; }).join("")
            || `<div style="font-size:12px;color:#888;">Sin piezas</div>`;
    };
    filas("sp-mx-cat", Object.keys(CAT_MAP), k => (CAT_MAP[k] || k).replace(/^\S+\s/, ""), hoyC.cat, nuevaC.cat);
    filas("sp-mx-pre", SP_TRAMOS, k => k, hoyC.tramo, nuevaC.tramo);
    filas("sp-mx-mat", Object.keys(SP_MATS), k => SP_MATS[k], hoyC.mat, nuevaC.mat);

    $("sp-props").innerHTML = Object.keys(CAT_MAP).map(k => `<label class="sp-prop"><span>${CAT_MAP[k]}</span>
        <input type="range" min="0" max="70" step="5" value="${_spProps[k] || 0}" oninput="_spProps.${k}=+this.value;this.parentNode.querySelector('.v').textContent=this.value+'%'" onchange="spSugerir()"><span class="v">${_spProps[k] || 0}%</span></label>`).join("");
    const pend = _spPendientesTienda();
    $("sp-pend").hidden = !pend.length;
    if (pend.length) $("sp-pend-txt").innerHTML = `⚠️ <b>${pend.reduce((a, p) => a + (parseInt(p.stock_bodega) || 0), 0)} unidad(es)</b> de ${new Set(pend.map(_baseDiseno)).size} pieza(s) ya publicadas en la web siguen en <b>bodega</b> en Stock.`;
    $("sp-bar-info").innerHTML = `<b>+${a.length}</b> publicar · <b>−${q.length}</b> quitar → <b>${fin}</b> publicadas`;
    $("sp-publicar").disabled = !a.length && !q.length;
}

async function spPublicar() {
    const a = _spAdd.filter(d => d.on), q = _spDel.filter(d => d.on);
    if (!a.length && !q.length) return;
    const nMover = document.getElementById("sp-c-mover").checked ? a.flatMap(d => d.filas).reduce((t, p) => t + Math.max(0, parseInt(p.stock_bodega) || 0), 0) : 0;
    const nDevolver = document.getElementById("sp-c-mover").checked ? q.flatMap(d => d.filas).filter(p => (parseInt(p.stock_tienda) || 0) > 0).length : 0;
    if (!confirm(`¿Publicar ${a.length} pieza(s) y quitar ${q.length} de verexstore.com?${nMover ? `\n\nEn Stock pasarán ${nMover} unidad(es) de bodega a tienda.` : ""}${nDevolver ? `\nEn Stock regresarán ${nDevolver} talla(s) de tienda a bodega (las que se quitan).` : ""}`)) return;
    const btn = document.getElementById("sp-publicar");
    btn.disabled = true; btn.textContent = "⏳ Publicando…";
    const llamar = async (codigos, visible) => {
        for (let i = 0; i < codigos.length; i += 900) {
            const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "STOCK_PUBLICAR_VISIBLE", _pass: ADMIN_PASS, codigos: codigos.slice(i, i + 900), visible }) }).then(x => x.json()).catch(() => null);
            if (!r?.ok) throw new Error(r?.error || "sin respuesta del servidor");
            const ahora = new Date().toISOString();
            (r.cambiados || []).forEach(c => { const p = productos.find(x => x.codigo === c); if (p) { p.enCatalogo = visible; p[visible ? "publicadoEn" : "despublicadoEn"] = ahora; } });
        }
    };
    try {
        if (a.length) await llamar(a.flatMap(d => d.codigos), true);
        if (q.length) await llamar(q.flatMap(d => d.codigos), false);
        // Igual que «Enviar todo a Tienda» del Hub: lo publicado pasa en Stock de bodega a tienda (todas las unidades). Va DESPUÉS de publicar para no perder la fecha de publicación.
        let movidas = 0;
        if (a.length && document.getElementById("sp-c-mover").checked) {
            const mover = a.flatMap(d => d.filas).filter(p => (parseInt(p.stock_bodega) || 0) > 0).map(p => p.codigo);
            for (let i = 0; i < mover.length; i += 300) {
                const lote = mover.slice(i, i + 300);
                const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "STOCK_ASIGNAR_TIENDA", _pass: ADMIN_PASS, codigos: lote, cantidad: 100000 }) }).then(x => x.json()).catch(() => null);
                if (!r?.ok) throw new Error("se publicó, pero no se pudo mover a tienda en Stock: " + (r?.error || "sin respuesta del servidor"));
                lote.forEach(c => { const p = productos.find(x => x.codigo === c); if (p) { p.stock_tienda = (parseInt(p.stock_tienda) || 0) + (parseInt(p.stock_bodega) || 0); p.stock_bodega = 0; p.estado = "tienda"; } });
                movidas += lote.length;
            }
        }
        // Lo que se quita de la web y aún tiene piezas en tienda (ej. sin foto) regresa completo a bodega,
        // igual que «Devolver a bodega» del Hub. Se agrupa por cantidad porque esa acción mueve la misma cantidad por código.
        let devueltas = 0;
        if (q.length && document.getElementById("sp-c-mover").checked) {
            const porCant = {};
            q.flatMap(d => d.filas).forEach(p => { const t = parseInt(p.stock_tienda) || 0; if (t > 0) (porCant[t] = porCant[t] || []).push(p.codigo); });
            for (const [cant, cods] of Object.entries(porCant)) {
                for (let i = 0; i < cods.length; i += 300) {
                    const lote = cods.slice(i, i + 300);
                    const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "STOCK_DEVOLVER_BODEGA", _pass: ADMIN_PASS, codigos: lote, cantidad: +cant, origen: "tienda" }) }).then(x => x.json()).catch(() => null);
                    if (!r?.ok) throw new Error("se quitaron de la web, pero no se pudieron devolver a bodega en Stock: " + (r?.error || "sin respuesta del servidor"));
                    lote.forEach(c => { const p = productos.find(x => x.codigo === c); if (p) { p.stock_bodega = (parseInt(p.stock_bodega) || 0) + (+cant); p.stock_tienda = 0; p.estado = "bodega"; } });
                    devueltas += lote.length;
                }
            }
        }
        cfg.sugerirPublicar = { n: _spN, props: _spProps, matModo: _spMatModo, matProps: _spMatProps };
        fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "ACTUALIZAR_CONFIG", _pass: ADMIN_PASS, config: { sugerirPublicar: cfg.sugerirPublicar } }) }).catch(() => {});
        try { localStorage.setItem("vx_cfg", JSON.stringify(cfg)); } catch (_) {}
        toast(`✅ Tienda actualizada: +${a.length} publicadas, −${q.length} quitadas${movidas ? ` · ${nMover} unidad(es) pasadas de bodega a tienda en Stock` : ""}${devueltas ? ` · ${devueltas} devueltas a bodega` : ""}`, "#22c55e");
        _spVistos = new Set();
        spSugerir();
        try { renderAll(true); } catch (_) {}
    } catch (e) {
        toast("❌ No se pudo publicar: " + e.message + ". Lo que ya se publicó quedó guardado.", "#ef4444");
    } finally {
        btn.textContent = "Publicar cambios";
        btn.disabled = false;
    }
}
