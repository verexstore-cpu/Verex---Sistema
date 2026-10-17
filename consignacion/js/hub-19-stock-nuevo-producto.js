// Hub VEREX — Stock: nuevo producto (tallas, códigos, foto)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── NUEVO PRODUCTO EN STOCK ──────────────────────────────────────────
// Arma un prefijo de 2 letras (mismo formato que las categorías fijas:
// AN, PU, CO, AR, CJ...) para una categoría nueva, probando combinaciones
// hasta encontrar una que no choque con ninguna categoría ya usada — fija
// o personalizada. Sin esto, dos categorías nuevas podían terminar
// compartiendo el mismo prefijo de código sin que nadie lo notara.
function generarPrefijoCategoria(nombre, catsExtra) {
    const limpio = nombre.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ\s]/g, "");
    const palabras = limpio.split(/\s+/).filter(Boolean);
    const usados = new Set([
        "AN","PU","CO","AR","CJ","DJ","TB","CD","CA","RS","RE",
        ...catsExtra.map(c => c.codigo)
    ]);
    const candidatos = [];
    if (palabras.length >= 2) candidatos.push(palabras[0][0] + palabras[1][0]);
    if (palabras[0]) {
        for (let i = 1; i < palabras[0].length; i++) candidatos.push(palabras[0][0] + palabras[0][i]);
    }
    const letras = limpio.replace(/\s+/g, "");
    for (let i = 0; i < letras.length; i++) {
        for (let j = i + 1; j < letras.length; j++) candidatos.push(letras[i] + letras[j]);
    }
    for (const c of candidatos) {
        if (c.length === 2 && !usados.has(c)) return c;
    }
    return null;
}

function agregarCategoriaPersonalizada() {
    const nombre = prompt("Nombre de la nueva categoría (ej: Llaveros, Dijes Religiosos):");
    if (!nombre || !nombre.trim()) return;
    const cats = safeParseJSON(localStorage.getItem("vx_categorias_extra"), []);
    const codigo = generarPrefijoCategoria(nombre, cats);
    if (!codigo) { toast("⚠️ No se pudo generar un código único para esa categoría — prueba con otro nombre"); return; }
    cats.push({ codigo, nombre: nombre.trim() });
    localStorage.setItem("vx_categorias_extra", JSON.stringify(cats));
    cargarCategoriasPersonalizadas();
    document.getElementById("sn-categoria").value = codigo;
    toast(`✅ Categoría agregada: ${nombre.trim()} (${codigo})`);
}

function cargarCategoriasPersonalizadas() {
    const cats = safeParseJSON(localStorage.getItem("vx_categorias_extra"), []);
    const group = document.getElementById("sn-categorias-custom");
    if (!group) return;
    group.innerHTML = "";
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.codigo;
        opt.textContent = c.nombre;
        group.appendChild(opt);
    });
}

function escanearCodigoSN() {
    const codigo = prompt("Escanea o ingresa el código del producto:");
    if (codigo) { document.getElementById("sn-codigo-manual").value = codigo.trim().toUpperCase(); onCodigoSNInput(); }
}

function abrirStockNuevoProd() {
    iniciarSesionFotoCel();
    _snFotoBase64 = null; _snMaterial = null; _snTalla = null; _snTallasQty = {};
    _snMultiCodigos = [];
    window._snFotoUrl = null;
    const btnSN = document.querySelector("#modal-stock-nuevo .btn-dorado");
    if (btnSN) { btnSN.textContent = "✅ Guardar en Stock"; btnSN.disabled = false; }
    const inpTE = document.getElementById("sn-talla-especial"); if (inpTE) inpTE.value = "";
    const wrapTE = document.getElementById("sn-talla-especial-wrap"); if (wrapTE) wrapTE.style.display = "none";
    document.getElementById("sn-foto-preview").innerHTML = "📷";
    _fotoCelLastUrl = null;
    document.getElementById("sn-foto-input").value = "";
    document.getElementById("sn-codigo-manual").value = "";
    document.getElementById("sn-nombre").value = "";
    document.getElementById("sn-categoria").value = "";
    document.getElementById("sn-precio").value = "";
    document.getElementById("sn-precio-dama").value = "";
    document.getElementById("sn-precio-caballero").value = "";
    document.getElementById("sn-precio-unisex").value = "";
    document.getElementById("sn-precio").style.display = "";
    document.getElementById("sn-precio-set").style.display = "none";
    document.getElementById("sn-cantidad").value = "1";
    document.getElementById("sn-desc").value = "";
    document.getElementById("sn-desc-tienda").value = "";
    const inpCaract = document.getElementById("sn-caract"); if (inpCaract) inpCaract.value = "";
    iniciarOcasionesSN();
    document.getElementById("sn-btn-ia").style.display = "none";
    document.getElementById("sn-ia-estado").style.display = "none";
    document.getElementById("sn-talla-container").style.display = "none";
    document.getElementById("sn-talla-set-container").style.display = "none";
    document.getElementById("sn-tallas-set-resumen").style.display = "none";
    _snTallasQtyDama = {}; _snTallasQtyCaballero = {};
    document.getElementById("sn-multicod-container").style.display = "none";
    document.getElementById("sn-multicod-chips").innerHTML = "";
    document.querySelectorAll(".sn-mat-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; });
    document.querySelectorAll(".sn-talla-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; });
    // Reset set_config — Individual por defecto
    document.querySelectorAll(".sn-set-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; b.style.borderColor="var(--borde)"; b.classList.remove("selected"); });
    const snSetDefault = document.querySelector('.sn-set-btn[data-set=""]');
    if (snSetDefault) { snSetDefault.style.background="var(--dorado)"; snSetDefault.style.color="#111"; snSetDefault.style.borderColor="var(--dorado)"; snSetDefault.classList.add("selected"); }
    abrirModal("modal-stock-nuevo");
    cargarFotoCelPendienteSN(); // debe ir DESPUÉS del reset para que no se borre
}

function seleccionarMatSN(btn) {
    document.querySelectorAll(".sn-mat-btn").forEach(b => { b.style.background="var(--gris2)"; b.style.color="var(--blanco)"; });
    btn.style.background = "var(--dorado)"; btn.style.color = "var(--negro)";
    _snMaterial = btn.dataset.mat;
}

let _snTallasQty = {}; // { "8": 2, "9": 1, "10": 3 }
let _snTallasQtyDama = {};
let _snTallasQtyCaballero = {};

function seleccionarTallaSN(talla) {
    const t = String(talla);
    if (_snTallasQty[t] !== undefined) {
        delete _snTallasQty[t]; // deseleccionar
    } else {
        _snTallasQty[t] = 1; // seleccionar con qty 1
    }
    // Mantener _snTalla para compatibilidad (primera talla seleccionada)
    const keys = Object.keys(_snTallasQty);
    _snTalla = keys.length ? parseInt(keys[0]) : null;
    // Actualizar botones
    document.querySelectorAll(".sn-talla-btn").forEach(b => {
        const sel = _snTallasQty[b.dataset.talla] !== undefined;
        b.style.background  = sel ? "var(--dorado)" : "var(--gris2)";
        b.style.color       = sel ? "var(--negro)"  : "var(--blanco)";
        b.style.borderColor = sel ? "var(--dorado)" : "var(--borde)";
    });
    renderResumenTallasSN();
}

function renderTallaSetSN() {
    const cont = document.getElementById("sn-talla-set-container");
    if (!cont) return;
    const tallasStd = [5,6,7,8,9,10,11,12,13,14];
    const esUnisex = (document.getElementById("sn-precio-unisex-wrap")?.style.display || "") !== "none";
    function btnSet(t, tipo, map) {
        const sel = map[String(t)] !== undefined;
        return `<button type="button" onclick="seleccionarTallaSNSet(${t},'${tipo}')"
            style="padding:5px 9px;border:1px solid ${sel?'var(--dorado)':'var(--borde)'};border-radius:6px;
            background:${sel?'var(--dorado)':'var(--gris2)'};color:${sel?'var(--negro)':'var(--blanco)'};
            font-size:11px;font-weight:600;cursor:pointer;">T${t}</button>`;
    }
    if (esUnisex) {
        cont.innerHTML = `
            <div style="margin-bottom:8px;">
                <label style="font-size:11px;color:var(--plateado);display:block;margin-bottom:5px;">💍 Tallas:</label>
                <div style="display:flex;flex-wrap:wrap;gap:5px;">${tallasStd.map(t=>btnSet(t,'U',_snTallasQtyDama)).join('')}</div>
            </div>`;
    } else {
        cont.innerHTML = `
            <div style="margin-bottom:8px;">
                <label style="font-size:11px;color:var(--plateado);display:block;margin-bottom:5px;">💃 Tallas Dama:</label>
                <div style="display:flex;flex-wrap:wrap;gap:5px;">${tallasStd.map(t=>btnSet(t,'D',_snTallasQtyDama)).join('')}</div>
            </div>
            <div>
                <label style="font-size:11px;color:var(--plateado);display:block;margin-bottom:5px;">🕺 Tallas Caballero:</label>
                <div style="display:flex;flex-wrap:wrap;gap:5px;">${tallasStd.map(t=>btnSet(t,'C',_snTallasQtyCaballero)).join('')}</div>
            </div>`;
    }
    renderResumenTallasSetSN();
}

function renderResumenTallasSetSN() {
    const cont = document.getElementById("sn-tallas-set-resumen");
    if (!cont) return;
    const esUnisex = (document.getElementById("sn-precio-unisex-wrap")?.style.display || "") !== "none";
    const entriesD = Object.entries(_snTallasQtyDama);
    const entriesC = Object.entries(_snTallasQtyCaballero);
    if (!entriesD.length && !entriesC.length) { cont.innerHTML = ""; return; }
    const chip = (emoji, t, q, tipo) => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(201,168,76,0.15);border:1px solid var(--dorado);border-radius:6px;padding:3px 8px;font-size:11px;">
        ${emoji}T${t} <button type="button" onclick="cambiarQtySetSN('${t}','${tipo}',-1)" style="background:none;border:none;color:var(--plateado);cursor:pointer;padding:0 2px;font-size:13px;line-height:1;">−</button>
        <span style="font-weight:700;color:var(--dorado);">${q}</span>
        <button type="button" onclick="cambiarQtySetSN('${t}','${tipo}',1)" style="background:none;border:none;color:var(--plateado);cursor:pointer;padding:0 2px;font-size:13px;line-height:1;">+</button>
        <button type="button" onclick="quitarTallaSetSN('${t}','${tipo}')" title="Quitar talla" style="background:none;border:none;color:#e57373;cursor:pointer;padding:0 2px;font-size:12px;line-height:1;">✕</button></span>`;
    if (esUnisex) {
        const fila = entriesD.map(([t, q]) => chip('💍', t, q, 'U')).join('');
        cont.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;">${fila}</div>`;
    } else {
        const filaD = entriesD.map(([t, q]) => chip('💃', t, q, 'D')).join('');
        const filaC = entriesC.map(([t, q]) => chip('🕺', t, q, 'C')).join('');
        cont.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;">${filaD}${filaC}</div>`;
    }
}

function seleccionarTallaSNSet(talla, tipo) {
    const t = String(talla);
    if (tipo === 'U') {
        if (_snTallasQtyDama[t] !== undefined) { delete _snTallasQtyDama[t]; delete _snTallasQtyCaballero[t]; }
        else { _snTallasQtyDama[t] = 1; _snTallasQtyCaballero[t] = 1; }
    } else {
        const map = tipo === 'D' ? _snTallasQtyDama : _snTallasQtyCaballero;
        if (map[t] !== undefined) delete map[t]; else map[t] = 1;
    }
    renderTallaSetSN();
}

function cambiarQtySetSN(talla, tipo, delta) {
    const t = String(talla);
    if (tipo === 'U') {
        if (_snTallasQtyDama[t] === undefined) return;
        const nv = Math.max(1, (_snTallasQtyDama[t] || 1) + delta);
        _snTallasQtyDama[t] = nv; _snTallasQtyCaballero[t] = nv;
    } else {
        const map = tipo === 'D' ? _snTallasQtyDama : _snTallasQtyCaballero;
        if (map[t] === undefined) return;
        map[t] = Math.max(1, (map[t] || 1) + delta);
    }
    renderResumenTallasSetSN();
}

function cambiarQtySN(talla, delta) {
    const t = String(talla);
    if (_snTallasQty[t] === undefined) return;
    _snTallasQty[t] = Math.max(1, (_snTallasQty[t] || 1) + delta);
    renderResumenTallasSN();
}

function agregarTallaEspecialSN(val) {
    const t = String(val || "").trim();
    if (!t || isNaN(parseFloat(t))) return;
    const esSetActivo = (document.querySelector(".sn-set-btn.selected")?.dataset.set || "") !== "";
    if (esSetActivo) {
        // En modo set: agregar la talla especial a ambos mapas (Dama y Caballero),
        // sin borrar las demás tallas especiales ya agregadas — así se pueden
        // combinar varias tallas especiales distintas (ej: T3 y T16) con su propia cantidad.
        if (_snTallasQtyDama[t] !== undefined) { toast("⚠️ Esa talla ya está agregada"); return; }
        _snTallasQtyDama[t] = 1; _snTallasQtyCaballero[t] = 1;
        renderResumenTallasSetSN();
    } else {
        if (_snTallasQty[t] !== undefined) { toast("⚠️ Esa talla ya está agregada"); return; }
        _snTallasQty[t] = 1;
        renderResumenTallasSN();
    }
    const inp = document.getElementById("sn-talla-especial");
    if (inp) { inp.value = ""; inp.focus(); }
}

function quitarTallaSN(t) {
    delete _snTallasQty[String(t)];
    renderResumenTallasSN();
}

function quitarTallaSetSN(t, tipo) {
    const ts = String(t);
    if (tipo === 'U') {
        delete _snTallasQtyDama[ts]; delete _snTallasQtyCaballero[ts];
    } else {
        const map = tipo === 'D' ? _snTallasQtyDama : _snTallasQtyCaballero;
        delete map[ts];
    }
    renderResumenTallasSetSN();
}

function renderResumenTallasSN() {
    let cont = document.getElementById("sn-tallas-resumen");
    if (!cont) return;
    const entries = Object.entries(_snTallasQty);
    if (!entries.length) { cont.innerHTML = ""; return; }
    cont.innerHTML = `<div style="font-size:11px;color:var(--plateado);margin-bottom:6px;">Cantidades por talla:</div>` +
        entries.map(([t, q]) => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="min-width:36px;font-weight:700;color:var(--dorado);">T${t}</span>
                <button onclick="cambiarQtySN(${t},-1)" style="width:26px;height:26px;border-radius:50%;border:1px solid #555;background:#2a2a2a;color:#fff;cursor:pointer;font-size:14px;">−</button>
                <span style="min-width:20px;text-align:center;font-weight:700;">${q}</span>
                <button onclick="cambiarQtySN(${t},1)"  style="width:26px;height:26px;border-radius:50%;border:1px solid #555;background:#2a2a2a;color:#fff;cursor:pointer;font-size:14px;">+</button>
                <span style="font-size:11px;color:#888;">${q} pieza${q>1?'s':''}</span>
                <button onclick="quitarTallaSN('${t}')" title="Quitar talla" style="width:22px;height:22px;border-radius:50%;border:1px solid #663;background:none;color:#e57373;cursor:pointer;font-size:12px;margin-left:auto;">✕</button>
            </div>`).join('');
}

function mostrarTallaSN(cat) {
    const esAnillo = cat === "AN" || cat === "CJ";
    const codigoManual = (document.getElementById("sn-codigo-manual")?.value || "").trim().toUpperCase();
    const codigoYaTieneTalla = /T\d+(\.\d+)?$/.test(codigoManual);
    const hayMultiCodigos = _snMultiCodigos.length > 0;

    // Talla selector: solo si es anillo SIN código físico impreso y sin multi-códigos
    const esSetActivo = document.querySelector(".sn-set-btn.selected")?.dataset.set !== "";
    if (esAnillo && !codigoYaTieneTalla && !hayMultiCodigos) {
        document.getElementById("sn-talla-container").style.display = esSetActivo ? "none" : "block";
        document.getElementById("sn-talla-set-container").style.display = esSetActivo ? "block" : "none";
        document.getElementById("sn-tallas-set-resumen").style.display = esSetActivo ? "block" : "none";
        if (esSetActivo) renderTallaSetSN();
    } else {
        document.getElementById("sn-talla-container").style.display = "none";
        document.getElementById("sn-talla-set-container").style.display = "none";
        document.getElementById("sn-tallas-set-resumen").style.display = "none";
    }

    // Multi-código panel: si el código ya tiene talla O ya hay chips
    document.getElementById("sn-multicod-container").style.display =
        (esAnillo && (codigoYaTieneTalla || hayMultiCodigos)) ? "block" : "none";

    // Cantidad: si no es anillo, o es anillo con código físico único (sin multi-chips)
    document.getElementById("sn-cantidad-wrap").style.display =
        (!esAnillo || (codigoYaTieneTalla && !hayMultiCodigos)) ? "block" : "none";

    // Talla especial: visible cuando es anillo (tanto con selector como con código físico)
    document.getElementById("sn-talla-especial-wrap").style.display =
        (esAnillo && !hayMultiCodigos) ? "block" : "none";

    // Limpiar selección de tallas al cambiar categoría
    _snTallasQty = {}; _snTalla = null;
    document.querySelectorAll(".sn-talla-btn").forEach(b => {
        b.style.background = "var(--gris2)"; b.style.color = "var(--blanco)"; b.style.borderColor = "var(--borde)";
    });
    const res = document.getElementById("sn-tallas-resumen");
    if (res) res.innerHTML = "";
}

// Detecta si el código manual ya incluye talla — activa modo multi-código
let _snMultiCodigos = []; // [{ codigo, talla, codigoBase }]

function onCodigoSNInput() {
    // Solo muestra/oculta paneles según si el código tiene talla — NO agrega el código
    // El código se agrega al presionar Enter (onCodigoSNEnter)
    const val = (document.getElementById("sn-codigo-manual")?.value || "").trim().toUpperCase();
    const cat = document.getElementById("sn-categoria")?.value || "";
    const tieneTalla = /T\d+(\.\d+)?$/.test(val);
    const esAnillo = cat === "AN" || cat === "CJ";

    if (esAnillo && (tieneTalla || _snMultiCodigos.length > 0)) {
        document.getElementById("sn-talla-container").style.display        = "none";
        document.getElementById("sn-multicod-container").style.display      = "block";
        document.getElementById("sn-cantidad-wrap").style.display           = "none";
        document.getElementById("sn-talla-especial-wrap").style.display     = tieneTalla ? "block" : "none";
    } else if (esAnillo) {
        document.getElementById("sn-talla-container").style.display        = "block";
        document.getElementById("sn-multicod-container").style.display      = "none";
        document.getElementById("sn-cantidad-wrap").style.display           = "none";
        document.getElementById("sn-talla-especial-wrap").style.display     = "block";
    }
}

// Se llama al presionar Enter en el campo de código principal
function onCodigoSNEnter(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inp = document.getElementById("sn-codigo-manual");
    const val = (inp?.value || "").trim().toUpperCase();
    const cat = document.getElementById("sn-categoria")?.value || "";
    const tieneTalla = /T\d+(\.\d+)?$/.test(val);
    const esAnillo = cat === "AN" || cat === "CJ";

    if (esAnillo && tieneTalla && val) {
        // Agregar a la lista multi-código
        agregarCodigoMultiDesde(val);
        inp.value = "";
        // Enfocar sn-multicod-input para el siguiente scan
        setTimeout(() => document.getElementById("sn-multicod-input")?.focus(), 80);
    } else {
        // Comportamiento normal: ir al nombre
        document.getElementById("sn-nombre")?.focus();
    }
}

function agregarCodigoMultiDesde(cod) {
    cod = cod.trim().toUpperCase();
    if (!cod) return;
    // Si ya está en la lista, sumar 1 a la cantidad en lugar de rechazar
    const yaEnLista = _snMultiCodigos.find(c => c.codigo === cod);
    if (yaEnLista) { yaEnLista.qty = (yaEnLista.qty || 1) + 1; renderMultiCodigos(); toast(`+1 — ${cod} ahora ×${yaEnLista.qty}`); return; }
    // Si ya existe en stock, agregar como reabastecimiento (suma a stock_bodega)
    const existeDup = stockData.find(s => String(s.codigo).toUpperCase() === cod);
    if (existeDup) {
        const m2 = cod.match(/^(.+?)T(\d+(?:\.\d+)?)$/i);
        _snMultiCodigos.push({ codigo: cod, talla: m2?m2[2]:"", codigoBase: m2?m2[1]:cod, qty: 1, esRestock: true, nombreExistente: existeDup.nombre });
        renderMultiCodigos();
        toast(`+1 a bodega — ${existeDup.nombre}`);
        setTimeout(() => document.getElementById("sn-multicod-input")?.focus(), 80);
        return;
    }
    // Extraer talla y base
    const m = cod.match(/^(.+?)T(\d+(?:\.\d+)?)$/i);
    const talla = m ? m[2] : "";
    const codigoBase = m ? m[1] : cod;
    _snMultiCodigos.push({ codigo: cod, talla, codigoBase, qty: 1 });
    renderMultiCodigos();
    setTimeout(() => document.getElementById("sn-multicod-input")?.focus(), 80);
}

function agregarCodigoMulti() {
    const inp = document.getElementById("sn-multicod-input");
    const val = (inp?.value || "").trim().toUpperCase();
    if (!val) return;
    agregarCodigoMultiDesde(val);
    if (inp) inp.value = "";
    inp?.focus();
}

function quitarCodigoMulti(cod) {
    _snMultiCodigos = _snMultiCodigos.filter(c => c.codigo !== cod);
    renderMultiCodigos();
    if (_snMultiCodigos.length === 0) {
        document.getElementById("sn-multicod-container").style.display = "none";
        document.getElementById("sn-talla-container").style.display = "block";
    }
}

function cambiarQtyMulti(cod, delta) {
    const item = _snMultiCodigos.find(c => c.codigo === cod);
    if (!item) return;
    item.qty = Math.max(1, (item.qty || 1) + delta);
    renderMultiCodigos();
}

function renderMultiCodigos() {
    const wrap = document.getElementById("sn-multicod-chips");
    if (!wrap) return;
    wrap.innerHTML = _snMultiCodigos.map(c => `
        <div style="display:flex;align-items:center;gap:6px;background:${c.esRestock ? 'rgba(46,204,113,0.08)' : 'rgba(201,168,76,0.08)'};border:1px solid ${c.esRestock ? '#2ecc71' : 'var(--dorado)'};border-radius:10px;padding:6px 10px;font-size:12px;margin-bottom:4px;">
            <div style="flex:1;min-width:0;">
                <span style="font-weight:700;color:${c.esRestock ? '#2ecc71' : 'var(--dorado)'};">${c.codigo}</span>
                ${c.esRestock ? `<span style="display:block;font-size:10px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📦 +bodega: ${c.nombreExistente||''}</span>` : ''}
            </div>
            <button onclick="cambiarQtyMulti('${c.codigo}',-1)" style="width:22px;height:22px;border-radius:50%;border:1px solid #555;background:#2a2a2a;color:#fff;cursor:pointer;font-size:13px;line-height:1;">−</button>
            <span style="min-width:20px;text-align:center;font-weight:700;">${c.qty || 1}</span>
            <button onclick="cambiarQtyMulti('${c.codigo}',1)"  style="width:22px;height:22px;border-radius:50%;border:1px solid #555;background:#2a2a2a;color:#fff;cursor:pointer;font-size:13px;line-height:1;">+</button>
            <span style="color:#888;font-size:10px;margin-left:2px;">pza${(c.qty||1)>1?"s":""}</span>
            <span onclick="quitarCodigoMulti('${c.codigo}')" style="cursor:pointer;color:#e74c3c;font-size:16px;margin-left:4px;line-height:1;">×</span>
        </div>`).join("");
}

function onCodigoNPInput() {
    const val = (document.getElementById("np-codigo")?.value || "").trim().toUpperCase();
    const cat = document.getElementById("np-categoria")?.value || "";
    const tieneTalla = /T\d+(\.\d+)?$/.test(val);
    const esAnillo = cat === "AN" || cat === "CJ";
    const container = document.getElementById("np-talla-container");
    if (esAnillo && container) {
        container.style.display = tieneTalla ? "none" : "block";
        if (tieneTalla) {
            const m = val.match(/T(\d+(?:\.\d+)?)$/);
            if (m) toast(`📌 Talla ${m[1]} detectada en el código — se usará como pieza única`);
            window._tallasQtyIndividual = {};
            renderTallasIndividual();
        }
    }
}

let _snFotoOriginalBase64 = "";
let _snFotoOriginalFile = null;
let _snFotoCropCoords = null;

// Muestra la foto en el recuadro de "Agregar Pieza al Stock" con encuadre
// arrastrable (mueve/zoomea sobre el original) — reutilizado tanto al elegir
// un archivo como al recibir la foto desde el celular, para que el ajuste
// manual funcione igual sin importar de dónde vino la imagen.
function mostrarFotoStockConEncuadre(r) {
    _snFotoOriginalBase64 = r.original;
    if (r._file) _snFotoOriginalFile = r._file;
    _snFotoCropCoords = r.crop;
    _snFotoBase64 = r.preview;
    document.getElementById("sn-btn-ia").style.display = "flex";
    if (!r.crop) {
        // Detección totalmente fallida (imagen corrupta) — sin recorte que ajustar
        const prev = document.getElementById("sn-foto-preview");
        if (prev) prev.innerHTML = `<img src="${_snFotoBase64}" style="width:100%;height:100%;object-fit:contain;">`;
        return;
    }
    const imgObj = new Image();
    imgObj.onload = () => {
        montarEncuadreArrastrable("sn-foto-preview", imgObj,
            () => _snFotoCropCoords,
            (c) => { _snFotoCropCoords = c; },
            (canvas) => { _snFotoBase64 = canvas.toDataURL("image/jpeg", 0.93); }
        );
    };
    imgObj.src = _snFotoOriginalBase64;
}

async function cargarFotoStockNuevo(input) {
    const file = input.files[0]; if (!file) return;
    _snFotoOriginalFile = file;
    const r = await procesarFotoJoya(file);
    mostrarFotoStockConEncuadre(r);
}

async function analizarFotoStockNuevo() {
    if (!_snFotoBase64) return;
    const estado = document.getElementById("sn-ia-estado");
    estado.style.display = "block"; estado.textContent = "⏳ Analizando con IA...";
    try {
        const imagenIA = await comprimirParaIA(_snFotoBase64);
        const res = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ accion: "ANALIZAR_IMAGEN", _pass: _sessionPass, imagen: imagenIA, material: _snMaterial })
        });
        const data = await res.json();
        if (data.ok) {
            const capFirst = s => s ? s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
            document.getElementById("sn-nombre").value = capFirst(data.resultado.nombre || "");
            document.getElementById("sn-desc").value = data.resultado.descripcion || "";
            document.getElementById("sn-desc-tienda").value = data.resultado.descripcion_tienda || "";
            if (data.resultado.categoria) {
                document.getElementById("sn-categoria").value = data.resultado.categoria;
                mostrarTallaSN(data.resultado.categoria);
            }
            estado.textContent = "✅ IA completó el análisis";
        } else {
            // Antes, si el servidor respondía data.ok:false (Groq caído, key
            // faltante, etc.) no pasaba nada visible — quedaba pegado en
            // "Analizando..." sin decir por qué.
            estado.textContent = "⚠️ " + (data.error || "Error al analizar");
        }
    } catch(e) { estado.textContent = "⚠️ Error al analizar: " + e.message; }
}

async function guardarStockNuevo() {
    const nombreVal  = document.getElementById("sn-nombre").value.trim();
    const categoria  = document.getElementById("sn-categoria").value;
    const setConfigSN  = document.querySelector(".sn-set-btn.selected")?.dataset.set || "";
    const esSetSN      = setConfigSN !== "";
    const esUnisexSN   = esSetSN && document.getElementById("sn-precio-unisex-wrap")?.style.display !== "none";
    const precio       = esSetSN
        ? (esUnisexSN ? document.getElementById("sn-precio-unisex").value
                      : document.getElementById("sn-precio-dama").value)
        : document.getElementById("sn-precio").value;
    const precioCaballeroSN = esSetSN
        ? (esUnisexSN ? (parseFloat(precio) || 0)
                      : (parseFloat(document.getElementById("sn-precio-caballero").value) || 0))
        : undefined;
    const esAnillo   = categoria === "AN" || categoria === "CJ";
    const cantidad   = parseInt(document.getElementById("sn-cantidad").value) || 1;

    // Rescatar códigos con talla que el usuario escribió pero no confirmó con Enter
    if (esAnillo) {
        for (const fieldId of ["sn-codigo-manual", "sn-multicod-input"]) {
            const val = (document.getElementById(fieldId)?.value || "").trim().toUpperCase();
            if (val && /T\d+(\.\d+)?$/.test(val) && !_snMultiCodigos.find(c => c.codigo === val)) {
                const m2 = val.match(/^(.+?)T(\d+(?:\.\d+)?)$/i);
                const entry = { codigo: val, talla: m2 ? m2[2] : "", codigoBase: m2 ? m2[1] : val, qty: 1 };
                const existeDup = stockData.find(s => String(s.codigo).toUpperCase() === val);
                if (existeDup) entry.esRestock = true;
                if (fieldId === "sn-codigo-manual") _snMultiCodigos.unshift(entry);
                else _snMultiCodigos.push(entry);
            }
        }
    }

    const modoMultiCod = esAnillo && _snMultiCodigos.length > 0;
    const codigoManualTemp = (document.getElementById("sn-codigo-manual")?.value || "").trim().toUpperCase();
    const codigoYaTieneTallaTemp = /T\d+(\.\d+)?$/.test(codigoManualTemp);
    if (!nombreVal || !categoria || !precio) { toast("⚠️ Completa nombre, categoría y precio"); return; }
    if (!_snMaterial) { toast("⚠️ Selecciona el material del producto"); return; }
    if (esSetSN && !esUnisexSN && !precioCaballeroSN) { toast("⚠️ Completa el precio de caballero"); return; }
    if (esAnillo && !modoMultiCod && !codigoYaTieneTallaTemp && Object.keys(_snTallasQty).length === 0 && Object.keys(_snTallasQtyDama).length === 0 && Object.keys(_snTallasQtyCaballero).length === 0) { toast("⚠️ Selecciona al menos una talla o escanea los códigos físicos"); return; }
    if (modoMultiCod && _snMultiCodigos.length === 0) { toast("⚠️ Escanea al menos un código"); return; }

    const btn = document.querySelector("#modal-stock-nuevo .btn-dorado");
    btn.textContent = "⏳ Guardando..."; btn.disabled = true;

    try {
        const desc          = document.getElementById("sn-desc").value.trim();
        const descTienda    = document.getElementById("sn-desc-tienda").value.trim();
        const caractEspecial = (document.getElementById("sn-caract")?.value || "").trim();
        // Ocasiones elegidas (15 años, compromiso…): se guardan en cada talla que se registra.
        const ocasionesSN = [..._snOcasiones];
        const conOcasiones = ocasionesSN.length ? { ocasiones: ocasionesSN } : {};
        const setConfig  = setConfigSN || null;
        const precioNum  = parseFloat(precio);

        // ── Modo multi-código: salida temprana ───────────────────────────────
        if (modoMultiCod) {
            // Rescatar códigos pendientes en campos (si el usuario no presionó Enter)
            for (const fieldId of ["sn-codigo-manual", "sn-multicod-input"]) {
                const val = (document.getElementById(fieldId)?.value || "").trim().toUpperCase();
                if (val && /T\d+(\.\d+)?$/.test(val) && !_snMultiCodigos.find(c => c.codigo === val)) {
                    const m2 = val.match(/^(.+?)T(\d+(?:\.\d+)?)$/i);
                    const entry = { codigo: val, talla: m2 ? m2[2] : "", codigoBase: m2 ? m2[1] : val, qty: 1 };
                    if (fieldId === "sn-codigo-manual") _snMultiCodigos.unshift(entry); // primero
                    else _snMultiCodigos.push(entry);
                }
            }
            const primerBase = _snMultiCodigos[0]?.codigoBase || nombreVal;
            let fotoUrlMulti = window._snFotoUrl || "";
            if (_snFotoBase64) {
                const url = await subirFotoImageKit(_snFotoOriginalFile || _snFotoOriginalBase64 || _snFotoBase64, primerBase, _snFotoCropCoords);
                if (url) fotoUrlMulti = url;
                else if (!confirm("La foto NO se pudo subir a ImageKit (revisa tu conexión; si la foto es muy grande, prueba con una más liviana).\n\nAceptar = guardar el producto SIN foto (aparecerá como «SIN FOTO» en Stock)\nCancelar = no guardar todavía, para intentarlo de nuevo")) { btn.textContent = "✅ Guardar en Stock"; btn.disabled = false; return; }
            }
            let guardados = 0;
            const nuevos   = _snMultiCodigos.filter(c => !c.esRestock);
            const restock  = _snMultiCodigos.filter(c =>  c.esRestock);
            // Registrar productos nuevos
            for (const { codigo, talla, codigoBase: cb, qty } of nuevos) {
                const res = await apiPost({
                    accion: "STOCK_REGISTRAR",
                    codigo, codigoBase: cb, talla,
                    nombre:      talla ? `${nombreVal} T${talla}` : nombreVal,
                    nombre_base: nombreVal,
                    categoria, precio: precioNum,
                    foto: fotoUrlMulti, cantidad: qty || 1,
                    material: _snMaterial || "",
                    descripcion: desc, descripcionTienda: descTienda,
                    caracterEspecial: caractEspecial,
                    ...conOcasiones,
                    set_config: setConfig || undefined,
                    precio_caballero: precioCaballeroSN
                });
                if (res.ok) guardados++;
            }
            // Sumar unidades a productos existentes
            if (restock.length > 0) {
                const itemsRestock = restock.map(c => {
                    const prod = stockData.find(s => String(s.codigo).toUpperCase() === c.codigo);
                    return { codigo: c.codigo, stock_bodega: (parseInt(prod?.stock_bodega) || 0) + (c.qty || 1) };
                });
                const res = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: itemsRestock });
                if (res.ok) {
                    guardados += restock.length - (res.notFound?.length || 0);
                    // Códigos eliminados de la BD → registrarlos como nuevos
                    for (const cod of (res.notFound || [])) {
                        const c = restock.find(r => r.codigo === cod);
                        if (!c) continue;
                        const r2 = await apiPost({
                            accion: "STOCK_REGISTRAR",
                            codigo: c.codigo, codigoBase: c.codigoBase, talla: c.talla,
                            nombre:      c.talla ? `${nombreVal} T${c.talla}` : nombreVal,
                            nombre_base: nombreVal,
                            categoria, precio: precioNum,
                            foto: fotoUrlMulti, cantidad: c.qty || 1,
                            material: _snMaterial || "",
                            descripcion: desc, descripcionTienda: descTienda,
                            caracterEspecial: caractEspecial,
                            ...conOcasiones,
                            set_config: setConfig || undefined,
                    precio_caballero: precioCaballeroSN
                        });
                        if (r2.ok) guardados++;
                    }
                }
            }
            // Códigos escaneados de un diseño que ya existía (reabastecer o talla nueva): sus otras tallas no pasan
            // por STOCK_REGISTRAR, así que se etiqueta el diseño completo (el Worker expande por código base).
            let avisoOc = "";
            if (ocasionesSN.length && (restock.length || nuevos.some(c => stockData.some(s => getCodigoBase(s.codigo) === getCodigoBase(c.codigo))))) {
                const rOc = await apiPost({ accion: "STOCK_OCASIONES", codigos: _snMultiCodigos.map(c => c.codigo).slice(0, 60), agregar: ocasionesSN }).catch(() => null);
                if (!rOc || !rOc.ok) avisoOc = " · ⚠️ las ocasiones del diseño NO se guardaron (márcalas en ✏️ Editar)";
            }
            const codigosGuardados = _snMultiCodigos.filter((_, i) => i < guardados).map(x => ({ codigo: x.codigo, qty: x.qty || 1 }));
            const msgNuevos  = nuevos.length  ? `${nuevos.length} nueva${nuevos.length>1?"s":""}` : "";
            const msgRestock = restock.length ? `${restock.length} reabastecida${restock.length>1?"s":""}` : "";
            toast(`✅ ${[msgNuevos, msgRestock].filter(Boolean).join(" + ")} en bodega${avisoOc}`, avisoOc ? "#f97316" : undefined, avisoOc ? 8000 : undefined);
            _snMultiCodigos = [];
            cerrarModal("modal-stock-nuevo");
            await cargarStock();
            btn.textContent = "✅ Guardar en Stock"; btn.disabled = false;
            ofrecerEtiquetaRapida(codigosGuardados);
            return;
        }

        // ── Flujo normal (código único o tallas con selector) ────────────────
        const codigoManual = document.getElementById("sn-codigo-manual").value.trim().toUpperCase();
        let codigoBase = codigoManual;
        if (!codigoBase) {
            codigoBase = generarCodigo(categoria, _snMaterial);
        } else {
            const existe = stockData.find(p => String(p.codigo).toUpperCase() === codigoBase);
            if (existe) {
                btn.textContent = "✅ Guardar en Stock"; btn.disabled = false;
                toast(`⚠️ Código ${codigoBase} ya existe — "${existe.nombre}"`);
                return;
            }
        }

        let fotoUrl = window._snFotoUrl || "";
        if (_snFotoBase64) {
            console.log("[guardar] tiene foto — file:", !!_snFotoOriginalFile, "b64:", !!_snFotoOriginalBase64, "crop:", _snFotoCropCoords);
            const url = await subirFotoImageKit(_snFotoOriginalFile || _snFotoOriginalBase64 || _snFotoBase64, codigoBase, _snFotoCropCoords);
            console.log("[guardar] subirFotoImageKit resultado:", url);
            if (url) fotoUrl = url;
            else if (!confirm("La foto NO se pudo subir a ImageKit (revisa tu conexión; si la foto es muy grande, prueba con una más liviana).\n\nAceptar = guardar el producto SIN foto (aparecerá como «SIN FOTO» en Stock)\nCancelar = no guardar todavía, para intentarlo de nuevo")) { btn.textContent = "✅ Guardar en Stock"; btn.disabled = false; return; }
        }

        // Si el código manual ya trae talla (SA18509JT7), guardarlo como pieza única
        const codigoYaTieneTalla = /T\d+(\.\d+)?$/.test(codigoBase);

        const esUnisexSN = esSetSN && document.getElementById("sn-precio-unisex-wrap")?.style.display !== "none";
        const tieneSetTallas = esSetSN && (Object.keys(_snTallasQtyDama).length > 0 || Object.keys(_snTallasQtyCaballero).length > 0);
        if (esAnillo && !codigoYaTieneTalla && tieneSetTallas) {
            let guardados = 0;
            const codigosEtiq = [];
            const precioDama = precioNum;
            const precioCab  = precioCaballeroSN || precioNum;
            // La PRIMER variante que se guarda en cada base fija esa base para
            // las demás (DT/CT comparten codigoBase; UT también). Si el código
            // es auto-generado y choca con stock real recién agregado, se
            // recalcula ahí — una sola vez por base — y el resto de la familia
            // ya usa la base corregida. codigoBase2 (trío 2+1) se deriva de un
            // codigoBase ya confirmado único, así que no necesita reintento.
            let baseConfirmada = !!codigoManual;
            async function registrarVarianteSet(sufijo, talla, qty, nombreConTalla, precio, baseUsar) {
                const construir = (base) => ({
                    accion: "STOCK_REGISTRAR",
                    codigo: base + sufijo + talla, codigoBase: base, talla,
                    nombre: nombreConTalla,
                    nombre_base: nombreVal,
                    categoria, precio,
                    foto: fotoUrl, cantidad: qty,
                    material: _snMaterial || "",
                    descripcion: desc, descripcionTienda: descTienda,
                    caracterEspecial: caractEspecial,
                    ...conOcasiones,
                    set_config: setConfig || undefined
                });
                let res, baseFinal = baseUsar;
                if (!baseConfirmada) {
                    const r = await guardarConCodigoUnico(categoria, _snMaterial, baseUsar, construir);
                    res = r.res; baseFinal = r.codigoBase;
                    codigoBase = baseFinal;
                    baseConfirmada = true;
                } else {
                    res = await apiPost(construir(baseUsar));
                }
                if (res.ok) { guardados++; codigosEtiq.push({ codigo: baseFinal + sufijo + talla, qty }); }
            }
            if (esUnisexSN) {
                // Unisex: una sola entrada por talla con sufijo UT
                for (const [talla, qty] of Object.entries(_snTallasQtyDama)) {
                    await registrarVarianteSet("UT", talla, qty, `${nombreVal} T${talla}`, precioDama, codigoBase);
                }
            } else {
                // Diferenciado: entrada DT para dama y CT para caballero
                for (const [talla, qty] of Object.entries(_snTallasQtyDama)) {
                    await registrarVarianteSet("DT", talla, qty, `${nombreVal} Dama T${talla}`, precioDama, codigoBase);
                }
                for (const [talla, qty] of Object.entries(_snTallasQtyCaballero)) {
                    await registrarVarianteSet("CT", talla, qty, `${nombreVal} Caballero T${talla}`, precioCab, codigoBase);
                }
                // Trío 2+1: segunda pieza de dama (ej. compromiso) — mismas tallas
                // que la pieza 1, pero con codigoBase propio y su propio precio,
                // para que el catálogo la reconozca como una pieza distinta.
                const precioDama2Raw = document.getElementById("sn-precio-dama2")?.value;
                if (setConfigSN === "2+1" && precioDama2Raw) {
                    const precioDama2 = parseFloat(precioDama2Raw) || 0;
                    const codigoBase2 = codigoBase + "B";
                    for (const [talla, qty] of Object.entries(_snTallasQtyDama)) {
                        await registrarVarianteSet("DT", talla, qty, `${nombreVal} Dama T${talla}`, precioDama2, codigoBase2);
                    }
                }
            }
            toast(`✅ ${guardados} variante${guardados > 1 ? 's' : ''} de set guardada${guardados > 1 ? 's' : ''} en stock`);
            cerrarModal("modal-stock-nuevo");
            btn.textContent = "✅ Guardar en Stock"; btn.disabled = false;
            await cargarStock();
            ofrecerEtiquetaRapida(codigosEtiq);
        } else if (esAnillo && !codigoYaTieneTalla && Object.keys(_snTallasQty).length > 0) {
            // Anillo con selector de tallas — crear una entrada por talla
            const tallas = Object.entries(_snTallasQty);
            let guardados = 0;
            const codigosTallas = [];
            const fallidas = [];
            for (let i = 0; i < tallas.length; i++) {
                const [talla, qty] = tallas[i];
                const construir = (base) => {
                    const codigo    = aplicarTalla(base, talla);
                    const tallaReal = codigo === base ? "" : talla;
                    return {
                        accion: "STOCK_REGISTRAR",
                        codigo, codigoBase: base, talla: tallaReal,
                        nombre:      aplicarTallaNombre(nombreVal, talla),
                        nombre_base: nombreVal,
                        categoria, precio: precioNum,
                        foto: fotoUrl, cantidad: qty,
                        material: _snMaterial || "",
                        descripcion: desc, descripcionTienda: descTienda,
                        caracterEspecial: caractEspecial,
                        ...conOcasiones,
                        set_config: setConfig || undefined,
                        precio_caballero: precioCaballeroSN
                    };
                };
                let res;
                if (i === 0 && !codigoManual) {
                    // La primera talla fija la base para el resto del anillo — si
                    // choca con stock real recién agregado, se recalcula acá.
                    const r = await guardarConCodigoUnico(categoria, _snMaterial, codigoBase, construir);
                    res = r.res; codigoBase = r.codigoBase;
                } else {
                    res = await apiPost(construir(codigoBase));
                }
                const codigo = aplicarTalla(codigoBase, talla);
                // Solo se pone en cola de etiquetas la talla que realmente se
                // guardó — si se encola una que falló, luego al imprimir el
                // sistema no la encuentra ("Producto no encontrado").
                if (res.ok) { guardados++; codigosTallas.push({ codigo, qty }); }
                else fallidas.push(`T${talla} (${res.error || "error"})`);
            }
            toast(`✅ ${guardados} talla${guardados > 1 ? 's' : ''} guardada${guardados > 1 ? 's' : ''} en stock`
                + (fallidas.length ? ` — ⚠️ falló: ${fallidas.join(", ")}` : ""));
            cerrarModal("modal-stock-nuevo");
            btn.textContent = "✅ Guardar en Stock"; btn.disabled = false;
            await cargarStock();
            ofrecerEtiquetaRapida(codigosTallas);
        } else {
            // Producto sin talla, o anillo con código físico ya impreso (SA18509JT7)
            const m = codigoBase.match(/^(.+?)T(\d+(?:\.\d+)?)$/i);
            const tallaExtraida = m ? m[2] : "";
            let baseExtraida = m ? m[1] : codigoBase;
            const construir = (base) => ({
                accion:      "STOCK_REGISTRAR",
                codigo:      tallaExtraida ? `${base}T${tallaExtraida}` : base,
                codigoBase:  base,
                talla:       tallaExtraida,
                nombre:      tallaExtraida ? `${nombreVal} T${tallaExtraida}` : nombreVal,
                nombre_base: nombreVal,
                categoria, precio: precioNum,
                foto: fotoUrl, cantidad,
                material: _snMaterial || "",
                descripcion: desc, descripcionTienda: descTienda,
                caracterEspecial: caractEspecial,
                ...conOcasiones,
                set_config: setConfig || undefined
            });
            let res;
            if (codigoManual) {
                res = await apiPost(construir(baseExtraida));
            } else {
                // Código auto-generado: si el servidor avisa que justo se ocupó
                // (otro dispositivo registró algo con ese prefijo momentos antes),
                // refresca el stock real y reintenta con el siguiente libre —
                // hasta 5 veces — en vez de mostrar el error crudo al usuario.
                const r = await guardarConCodigoUnico(categoria, _snMaterial, baseExtraida, construir);
                res = r.res; baseExtraida = r.codigoBase;
            }
            if (!res.ok) { toast("⚠️ " + (res.error || "Error al guardar")); btn.textContent = "✅ Guardar en Stock"; btn.disabled = false; return; }
            toast("✅ Producto guardado en stock");
            cerrarModal("modal-stock-nuevo");
            btn.textContent = "✅ Guardar en Stock"; btn.disabled = false;
            await cargarStock();
            const codigoFinal = tallaExtraida ? `${baseExtraida}T${tallaExtraida}` : baseExtraida;
            ofrecerEtiquetaRapida([{ codigo: codigoFinal, qty: cantidad }]);
        }
        return;
    } catch(e) { toast("⚠️ Error de conexión"); }

    btn.textContent = "✅ Guardar en Stock"; btn.disabled = false;
}
