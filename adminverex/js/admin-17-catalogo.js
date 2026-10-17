// Admin VEREX — Catálogo: armado, filtros, afiliados y modal
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
function getCatKey(p) {
    // Acepta el producto completo (preferido) o solo el código (compatibilidad)
    const prod = (p && typeof p === "object") ? p : { codigo: p };
    // Prioridad 1: campo categoria explícito (viene de Consignación, ej. "AN") —
    // más confiable que el prefijo del código, que puede llevar prefijo de material (ej. "P-AN001T6")
    const catField = String(prod.categoria || "").toUpperCase().trim();
    if (CAT_MAP[catField]) return catField;
    // Prioridad 2: prefijo de categoría dentro del código, por segmento separado por guion
    // (cubre tanto "AN-1234" como "PO-AN014DT6" con prefijo de material antes de la categoría)
    const c = String(prod.codigo || "").toUpperCase();
    const segs = c.split("-");
    for (const seg of segs) {
        for (const k of Object.keys(CAT_MAP)) { if (seg.startsWith(k)) return k; }
    }
    if (c.startsWith("U")) return "AN";
    // Prioridad 3: palabras clave en el nombre del producto (último recurso)
    const n = String(prod.nombre || "").toLowerCase();
    if (/anillo|argolla|alianza|matrimonio|solitario|novio|pareja/.test(n)) return "AN";
    if (/\barete|aretes|pendiente/.test(n))                                 return "AR";
    if (/cadena|collar|gargantilla/.test(n))                                return "CD";
    if (/pulsera|brazalete/.test(n))                                        return "PL";
    if (/conjunto|\bset\b/.test(n))                                         return "CN";
    if (/reloj/.test(n))                                                    return "RL";
    return "OT";
}

function getPrefijoProd(p) {
    if (/^U/i.test(p.codigo||"")) return "U";
    const n = (p.nombre||"").toLowerCase();
    if (/\bdama\b|\bmujer\b/.test(n))                return "D";
    if (/\bcaballero\b|\bhombre\b/.test(n))          return "C";
    if (/\bún[io]co\b|\bunico\b|\bunisex\b/.test(n)) return "U";
    const mCod = (p.codigo||"").match(/([CDHU])\d/i);
    if (mCod) return mCod[1].toUpperCase();
    return "T";
}

function tieneStock(p, talla) {
    // Consignación: campo talla plano + stock en stock_bodega/stock_tienda/stock_consignacion — fuente de verdad
    if (p.talla !== undefined && p.talla !== null && String(p.talla).trim() !== "") {
        if (talla && String(p.talla) !== String(talla)) return false; // otra talla: no cae al respaldo
        const totalConsig = (parseInt(p.stock_bodega)||0) + (parseInt(p.stock_tienda)||0) + (parseInt(p.stock_consignacion)||0);
        return totalConsig > 0;
    }
    // Admin (Nuevo Producto): JSON de tallas agregado (solo si no hay campo talla plano)
    let s = {};
    try { s = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
    if (talla) {
        return (parseInt(s[talla])||0) > 0
            || (parseInt(s["D"+talla])||0) > 0
            || (parseInt(s["H"+talla])||0) > 0
            || (parseInt(s["C"+talla])||0) > 0;
    }
    return Object.values(s).some(v => (parseInt(v)||0) > 0);
}

function agruparParaCatalogo(lista) {
    if (lista.length) console.log("[VEREX] campos producto:", Object.keys(lista[0]));
    const ES_DAMA_GRP = /\b(dama|mujer)\b/i;
    const ES_CAB_GRP  = /\b(caballero|hombre)\b/i;

    const hasDKey = p => { try { return Object.keys(JSON.parse(p.caracteristicas||"{}")).some(k=>/^D\d/i.test(k)); } catch(_){return false;} };
    // C keys (Caballero) and H keys (Hombre) both mark a caballero variant
    const hasCHKey = p => { try { return Object.keys(JSON.parse(p.caracteristicas||"{}")).some(k=>/^[HC]\d/i.test(k)); } catch(_){return false;} };

    // Al registrar un Set Par/Trío con precio Diferenciado, el sistema genera el
    // código con "DT" (dama) o "CT"/"HT" (caballero) justo después del codigoBase
    // (ej. ANP175DT7, ANP175CT10) — es la señal MÁS confiable, más que el nombre,
    // que puede quedar incompleto si se agregó una talla después manualmente.
    const sufijoCodigo = p => {
        const base = p.codigoBase || "";
        return (base && p.codigo && p.codigo.startsWith(base)) ? p.codigo.slice(base.length) : (p.codigo || "");
    };
    const codigoEsDama = p => /^D/i.test(sufijoCodigo(p));
    const codigoEsCab  = p => /^[CH]/i.test(sufijoCodigo(p));

    const isDamaP = p => codigoEsDama(p) || ES_DAMA_GRP.test(p.nombre||"") || hasDKey(p);
    const isCabP  = p => codigoEsCab(p)  || ES_CAB_GRP.test(p.nombre||"")  || hasCHKey(p);

    const addSz = (arr, sz) => { if (sz && !isNaN(parseFloat(sz)) && !arr.includes(sz)) arr.push(sz); };

    const stripBase = nombre => (nombre||"")
        .replace(/\s+[TCDHU]\d+(?:\.\d+)?\s*$/i, "")
        .replace(/\s+(dama|caballero|hombre|mujer|único|unico)\s*$/i, "")
        .trim();

    const map = new Map();
    lista.forEach(p => {
        const catKey = getCatKey(p);
        const baseNombre = catKey === "AN" ? stripBase(p.nombre) : (p.nombre||"").trim();
        const key = catKey === "AN" ? baseNombre : (p.nombre||p.codigo);
        if (!map.has(key)) {
            map.set(key, { ...p, nombre: baseNombre, _sizes: [], _sizesD: [], _sizesH: [], _codigos: [p.codigo], _catKey: catKey });
        }
        const g = map.get(key);
        if (!g._codigos.includes(p.codigo)) g._codigos.push(p.codigo);
        if (!getNotaEspecial(g) && getNotaEspecial(p)) g.caracterEspecial = getNotaEspecial(p);

        let s = {};
        try { s = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
        Object.entries(s).forEach(([k, v]) => {
            if ((parseInt(v) || 0) > 0) {
                if (/^D\d/i.test(k))           addSz(g._sizesD, k.replace(/^D/i,""));
                else if (/^[HC]\d/i.test(k))   addSz(g._sizesH, k.replace(/^[HC]/i,""));
                else                           addSz(g._sizes,  k);
            }
        });

        // Extract size from code/name suffix (e.g. AN001C9 → C → _sizesH, AN001D7 → D → _sizesD)
        const mCod = (p.codigo||"").match(/([TCDHU])(\d+(?:\.\d+)?)$/i);
        const mNom = (p.nombre||"").match(/([TCDHU])(\d+(?:\.\d+)?)\s*$/i);
        [mCod, mNom].forEach(m => {
            if (!m) return;
            const [, letra, num] = m;
            if (/^D$/i.test(letra))           addSz(g._sizesD, num);
            else if (/^[HC]$/i.test(letra))   addSz(g._sizesH, num);
            else                              addSz(g._sizes,  num);
        });
    });

    const sortNum = arr => arr.sort((a,b) => parseFloat(a)-parseFloat(b));
    map.forEach(g => { sortNum(g._sizes); sortNum(g._sizesD); sortNum(g._sizesH); });

    // Set pricing: suma precios de todas las piezas dama + caballero del grupo.
    // Un set normal es 1 dama + 1 caballero (pareja). Cuando hay 2 piezas dama
    // (ej. compromiso + matrimonio) + 1 caballero, es un trío — se detecta solo,
    // sin requerir ninguna opción nueva al ingresar stock.
    map.forEach(g => {
        // Antes exigía que el NOMBRE trajera una palabra en español (alianza,
        // matrimonio...) para intentar agrupar — eso dejaba fuera cualquier
        // diseño con nombre en inglés (ej. "One & Only") aunque sus códigos SÍ
        // traigan la letra D/C/H que identifica dama/caballero. Ahora basta con
        // que sea categoría Anillo: la detección real de pareja/trío más abajo
        // (isDamaP/isCabP) ya se apoya en el código, no en el nombre.
        if (g._catKey !== "AN") return;
        const originals = lista.filter(p => g._codigos.includes(p.codigo));
        let damas = originals.filter(isDamaP);
        let cabs  = originals.filter(isCabP);

        // Si faltan piezas en la lista filtrada, buscar en el catálogo completo
        if ((!damas.length || !cabs.length) && typeof productos !== "undefined") {
            const allAN = productos.filter(p => getCatKey(p) === "AN");
            const partners = allAN.filter(p => !g._codigos.includes(p.codigo) && stripBase(p.nombre) === g.nombre);
            if (!damas.length) {
                damas = partners.filter(isDamaP);
                damas.forEach(dama => {
                    let s2 = {}; try { s2 = JSON.parse(dama.caracteristicas||"{}"); } catch(_) {}
                    Object.entries(s2).forEach(([k,v]) => { if ((parseInt(v)||0)>0 && /^D\d/i.test(k)) addSz(g._sizesD, k.replace(/^D/i,"")); });
                });
                sortNum(g._sizesD);
            }
            if (!cabs.length) {
                cabs = partners.filter(isCabP);
                cabs.forEach(cab => {
                    let s2 = {}; try { s2 = JSON.parse(cab.caracteristicas||"{}"); } catch(_) {}
                    Object.entries(s2).forEach(([k,v]) => { if ((parseInt(v)||0)>0 && /^[HC]\d/i.test(k)) addSz(g._sizesH, k.replace(/^[HC]/i,"")); });
                });
                sortNum(g._sizesH);
            }
        }

        if (damas.length && cabs.length) {
            g._esPareja = true;
            // Varias filas pueden ser solo tallas distintas del MISMO anillo (mismo
            // codigoBase) — eso sigue siendo 1 sola pieza, no una por talla. Solo un
            // codigoBase distinto es una pieza físicamente diferente (ej. trío: anillo
            // de compromiso + anillo de matrimonio para dama, cada uno con su propio
            // codigoBase y sus propias tallas).
            const porDiseno = filas => {
                const map = new Map();
                filas.forEach(p => {
                    const key = p.codigoBase || p.codigo;
                    if (!map.has(key)) map.set(key, p); // una fila representativa por diseño
                });
                return [...map.values()];
            };
            const damasUnicas = porDiseno(damas);
            const cabsUnicos  = porDiseno(cabs);
            g._piezas = damasUnicas.length + cabsUnicos.length; // 2 = pareja, 3 = trío, etc.
            // OJO: en un par normal, dama y caballero SIEMPRE comparten el mismo
            // codigoBase (solo la 2da pieza dama de un trío tiene uno distinto,
            // con sufijo "B") — por eso aquí se compara por CÓDIGO exacto, no por
            // codigoBase, para detectar el caso real a evitar: que una misma fila
            // haya quedado clasificada a la vez como dama y como caballero.
            const codigosUnicos = new Set([...damasUnicas, ...cabsUnicos].map(p => p.codigo));
            if (codigosUnicos.size > 1) {
                g._precioDama = damasUnicas.reduce((sum,d) => sum + parseFloat(d.precio||0), 0).toFixed(2);
                g._precioCab  = cabsUnicos.reduce((sum,c) => sum + parseFloat(c.precio||0), 0).toFixed(2);
                // Un código representativo por cada pieza (dama y caballero) — el
                // catálogo los guarda para poder revisar el precio ACTUAL de cada
                // uno y recalcular el total en vivo, sin tener que regenerar el link.
                g._piezasCodigosDama = damasUnicas.map(d => d.codigo);
                g._piezasCodigosCab  = cabsUnicos.map(c => c.codigo);
            }
        }
    });

    return [...map.values()];
}

function poblarCategorias() {
    const presentes = [...new Set(productos.map(p => getCatKey(p)))];
    const orden = ["AN","AR","CD","PL","CN","RL","OT"];
    const pills = document.getElementById("cat-categoria-pills");
    if (!pills) return;
    const marcadas = new Set([...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value));
    const conteo = _wzConteoDisenos(_wzCoincideOcasion, getCatKey);
    pills.innerHTML = orden.filter(k => presentes.includes(k)).map(k => {
        const [ic, ...resto] = CAT_MAP[k].split(" ");
        const n = conteo[k] || 0;
        return `<label class="wz-card"><input type="checkbox" class="cat-cat-chk" value="${k}" ${marcadas.has(k) ? "checked" : ""} onchange="onPillChange()">
            <span class="ic">${ic}</span><span class="nm">${resto.join(" ")}</span><span class="ct">${n} pieza${n === 1 ? "" : "s"}</span></label>`;
    }).join("");
}

function onPillChange() {
    // La tarjeta marcada se pinta sola por CSS (.wz-card:has(input:checked)).
    const cats = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);
    const hasAN = cats.length === 0 || cats.includes("AN");
    document.getElementById("cat-sec-talla").style.display = hasAN ? "block" : "none";
    filtrarParaCatalogo();
}

// Mismo patrón visual que las pills de categoría, pero para material — ahora
// se puede combinar más de uno (ej. plata Y acero en el mismo catálogo) en
// vez de tener que elegir uno solo.
function onMaterialPillChange() {
    // La tarjeta marcada se pinta sola por CSS (.wz-card:has(input:checked)).
    filtrarParaCatalogo();
}

function onToggleAfiliado(checked) {
    // El tipo lo decide la pestaña (Catálogo Cliente / Catálogo Afiliado) — se
    // muestra solo la sección de la ficha que corresponde a ese tipo.
    const secAfiliado = document.getElementById("cat-sec-afiliado");
    if (secAfiliado) secAfiliado.style.display = checked ? "block" : "none";
    // El banner de oferta / % descuento no aplica a catálogos de afiliado —
    // ellos ganan comisión por venta y un descuento no acordado les afecta esa comisión.
    const bannerWrap = document.getElementById("cat-banner-wrap");
    if (bannerWrap) bannerWrap.style.display = checked ? "none" : "block";
    const bannerAfWrap = document.getElementById("cat-banner-afiliado-wrap");
    if (bannerAfWrap) bannerAfWrap.style.display = checked ? "block" : "none";
    const nombreLabel = document.getElementById("cat-nombre-label");
    if (nombreLabel) nombreLabel.textContent = checked ? "Nota interna (opcional)" : "Nombre del cliente (opcional)";
    if (checked) {
        const txtEl = document.getElementById("cat-banner-txt");
        const pctEl = document.getElementById("cat-banner-desc-pct");
        if (txtEl) txtEl.value = "";
        if (pctEl) pctEl.value = "";
        const prev = document.getElementById("banner-preview");
        if (prev) prev.style.display = "none";
        cargarVendedoresAfiliados();
        cargarBannerAfiliadoGlobal();
    }
}

// Barra de emojis rápidos para los banners (cliente y afiliado) — inserta el
// emoji en la posición del cursor del input indicado en data-target, sin
// pisar lo que el admin ya escribió.
const EMOJIS_BANNER = ["🎉","🔥","✨","💥","🎁","💸","📦","🚚","⏰","💯","❤️","🛍️","👑","⭐","🆕"];
function insertarEnCursor(inputId, texto) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + texto + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start + texto.length, start + texto.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
}
function _initEmojiQuickBars() {
    document.querySelectorAll(".emoji-quick-bar").forEach(bar => {
        if (bar.dataset.built) return;
        bar.dataset.built = "1";
        bar.style.cssText = "display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;";
        const target = bar.dataset.target;
        EMOJIS_BANNER.forEach(emo => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = emo;
            b.title = "Insertar " + emo;
            b.style.cssText = "border:1px solid #ddd;background:#fff;border-radius:5px;font-size:14px;padding:2px 5px;cursor:pointer;line-height:1.4;";
            b.onclick = () => insertarEnCursor(target, emo);
            bar.appendChild(b);
        });
    });
}
document.addEventListener("DOMContentLoaded", _initEmojiQuickBars);

let _bannerAfColor = "#7c3aed";
function selBannerAfColor(btn, color) {
    _bannerAfColor = color;
    document.querySelectorAll("#banner-af-colors button").forEach(b => b.style.border = "3px solid transparent");
    btn.style.border = "3px solid #111";
}
async function cargarBannerAfiliadoGlobal() {
    try {
        const res = await fetch("/banner-afiliado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _pass: ADMIN_PASS, _leer: true }),
        });
        const b = await res.json();
        document.getElementById("cat-banner-af-activo").checked = !!b.activo;
        document.getElementById("cat-banner-af-txt").value = b.txt || "";
        document.getElementById("cat-banner-af-sub").value = b.sub || "";
        _bannerAfColor = b.color || "#7c3aed";
        document.querySelectorAll("#banner-af-colors button").forEach(btn => {
            btn.style.border = (btn.getAttribute("onclick")||"").includes(`'${_bannerAfColor}'`) ? "3px solid #111" : "3px solid transparent";
        });
    } catch (e) { /* si falla, se deja el formulario en blanco para no bloquear */ }
}
async function guardarBannerAfiliadoGlobal() {
    const activo = document.getElementById("cat-banner-af-activo").checked;
    const txt = document.getElementById("cat-banner-af-txt").value.trim();
    const sub = document.getElementById("cat-banner-af-sub").value.trim();
    if (activo && !txt) return toast("⚠️ Escribe el texto del banner antes de activarlo", "#f97316");
    try {
        const res = await fetch("/banner-afiliado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activo, txt, sub, color: _bannerAfColor, _pass: ADMIN_PASS }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        toast("✅ Banner global de afiliados actualizado", "#22c55e");
    } catch (e) {
        toast("❌ Error al guardar: " + e.message, "#ef4444");
    }
}

let _vendedoresAfiliados = [];

async function cargarVendedoresAfiliados() {
    const sel = document.getElementById("cat-afiliado-select");
    if (!sel) return;
    sel.innerHTML = '<option value="">⏳ Cargando afiliados...</option>';
    try {
        const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_VENDEDORES_AFILIADOS", _pass: ADMIN_PASS }) });
        const data = await res.json();
        _vendedoresAfiliados = data.vendedores || [];
        if (!_vendedoresAfiliados.length) {
            sel.innerHTML = '<option value="">— Ninguno registrado aún —</option>';
            return;
        }
        sel.innerHTML = '<option value="">— Selecciona un afiliado —</option>' +
            _vendedoresAfiliados.map(v => `<option value="${esc(v.codigo)}">${esc(v.nombre)} (${esc(v.codigo)})</option>`).join("");
    } catch(e) {
        sel.innerHTML = '<option value="">⚠️ Error cargando afiliados</option>';
    }
}

function onSeleccionarAfiliado() {
    const sel = document.getElementById("cat-afiliado-select");
    const codigo = sel?.value || "";
    const v = _vendedoresAfiliados.find(x => x.codigo === codigo);
    document.getElementById("cat-afiliado-codigo").value = codigo;
    document.getElementById("cat-afiliado-nombre").value = v?.nombre || "";
    const waEl = document.getElementById("cat-wa");
    if (waEl && v?.telefono) {
        // El teléfono del vendedor se guarda local (8 dígitos, sin "503") —
        // el link de WhatsApp del catálogo necesita el código de país o el
        // cliente cree que envió el mensaje y nunca le llega a nadie.
        const soloDigitos = String(v.telefono).replace(/\D/g, "");
        waEl.value = soloDigitos.length === 8 ? "503" + soloDigitos : soloDigitos;
    }
    if (v) generarIdAfiliado(v.nombre);

    const btnRefrescar = document.getElementById("btn-refrescar-catalogo-afiliado");
    if (btnRefrescar) btnRefrescar.style.display = (v?.catalogoReceta) ? "block" : "none";
    const notaRefrescar = document.getElementById("txt-refrescar-nota");
    if (notaRefrescar) notaRefrescar.style.display = (v?.catalogoReceta) ? "block" : "none";
}

// Vuelve a aplicar los mismos criterios (categorías, talla, género, cantidad)
// usados la última vez que se generó el catálogo de este afiliado, pero
// contra el stock actual — así lo agotado se reemplaza por lo disponible
// en vez de que el catálogo se vaya achicando con cada venta. Deja la
// selección lista para revisar; el admin igual debe darle a "🔗 Link" para publicar.
function refrescarCatalogoAfiliado() {
    const codigo = document.getElementById("cat-afiliado-select")?.value || "";
    const v = _vendedoresAfiliados.find(x => x.codigo === codigo);
    const receta = v?.catalogoReceta;
    if (!receta) return toast("⚠️ Este afiliado no tiene criterios guardados aún","#f97316");

    document.querySelectorAll(".cat-cat-chk").forEach(chk => { chk.checked = (receta.categorias||[]).includes(chk.value); });
    poblarOcasionesPills(receta.ocasiones || []);
    onPillChange();
    if (document.getElementById("cat-talla"))   document.getElementById("cat-talla").value   = receta.talla   || "";
    sincronizarChipsCatTalla();
    if (document.getElementById("cat-genero"))  document.getElementById("cat-genero").value  = receta.genero  || "";
    if (document.getElementById("cat-tipo-an")) document.getElementById("cat-tipo-an").value = receta.tipoAN  || "";
    if (document.getElementById("cat-var-size")) document.getElementById("cat-var-size").value = receta.cantidad || 36;

    filtrarParaCatalogo();
    autoSeleccionarVariado(receta.ultimosCodigos || []);
}

function abrirModalCatalogo(tipo) {
    const esAfiliado = tipo === "afiliado";
    document.getElementById("modal-catalogo").classList.add("open");
    document.getElementById("modal-catalogo-titulo").textContent = esAfiliado
        ? "🤝 Catálogo para Afiliado / Distribuidor"
        : "📋 Catálogo para Cliente";
    document.getElementById("cat-tipo-an").value = "";
    document.getElementById("cat-talla").value   = "";
    sincronizarChipsCatTalla();
    document.getElementById("cat-genero").value  = "";
    document.getElementById("cat-nombre").value  = "";
    document.getElementById("cat-validez").value = esAfiliado ? "30" : "15";
    const esUsEl = document.getElementById("cat-es-us");
    if (esUsEl) esUsEl.checked = false;
    document.querySelectorAll(".cat-material-chk").forEach(chk => {
        chk.checked = false;
    });
    const descPctEl = document.getElementById("cat-banner-desc-pct");
    if (descPctEl) descPctEl.value = "";
    const promoTipoEl = document.getElementById("cat-promo-tipo");
    if (promoTipoEl) { promoTipoEl.value = ""; onCambioPromoTipo(); }
    [1,2,3].forEach(n => {
        const c = document.getElementById(`cat-esc-cant-${n}`), p = document.getElementById(`cat-esc-pct-${n}`);
        if (c) c.value = ""; if (p) p.value = "";
    });
    const montoFijoEl = document.getElementById("cat-promo-montofijo");
    if (montoFijoEl) montoFijoEl.value = "";
    const montoFijoMinEl = document.getElementById("cat-promo-montofijo-minimo");
    if (montoFijoMinEl) montoFijoMinEl.value = "";
    const envioEl = document.getElementById("cat-envio-gratis-desde");
    if (envioEl) envioEl.value = "";
    const regaloMontoEl = document.getElementById("cat-regalo-monto");
    if (regaloMontoEl) regaloMontoEl.value = "";
    const regaloTextoEl = document.getElementById("cat-regalo-texto");
    if (regaloTextoEl) regaloTextoEl.value = "";
    document.getElementById("cat-link-box").style.display  = "none";
    document.getElementById("cat-sec-talla").style.display = "block";
    if (document.getElementById("cat-nota-interna")) document.getElementById("cat-nota-interna").value = "";
    renderLogCatalogos();

    // Sección afiliado
    const afChk = document.getElementById("cat-es-afiliado");
    if (afChk) afChk.checked = esAfiliado;
    onToggleAfiliado(esAfiliado);
    if (!esAfiliado) iniciarPromoGeneralEnModal();
    // El WhatsApp de catálogo Cliente SIEMPRE es el oficial de VEREX — nunca
    // se debe rellenar con "verex-wa" (eso guarda el ÚLTIMO número usado, que
    // puede ser el de un afiliado si el admin generó un catálogo de afiliado
    // justo antes). Reusar ese valor causó que un pedido de cliente directo
    // le llegara por error al WhatsApp de un afiliado en vez de a VEREX.
    const waEl  = document.getElementById("cat-wa");            if (waEl)  waEl.value  = esAfiliado ? "" : VEREX_WA_OFICIAL;
    const afNom = document.getElementById("cat-afiliado-nombre"); if (afNom) afNom.value = "";
    const afId  = document.getElementById("cat-afiliado-id");     if (afId)  afId.value  = "";
    const afCod = document.getElementById("cat-afiliado-codigo"); if (afCod) afCod.value = "";
    const afSel = document.getElementById("cat-afiliado-select"); if (afSel) afSel.value = "";

    document.querySelectorAll(".cat-cat-chk").forEach(c => c.checked = false);
    poblarOcasionesPills([]);
    poblarCategorias();
    const pf = document.getElementById("cat-prefijo-txt");
    if (pf) pf.value = "";
    _catPrecio = { min: 0, max: 0 };
    const bus = document.getElementById("cat-buscar");      if (bus) bus.value = "";
    const iaOut = document.getElementById("cat-ia-resultado"); if (iaOut) iaOut.innerHTML = "";
    const afinar = document.getElementById("wz-afinar");    if (afinar) afinar.open = false;
    const usWrap = document.getElementById("wz-us-wrap");   if (usWrap) usWrap.open = false;
    _wzModoPromo = null; _wzPromoAbiertas.clear(); _wzAvisoBannerOk = "";
    sincronizarChipsCatTalla();
    wzRenderPlantillas();
    filtrarParaCatalogo();
    wzIr(1);
}

function cerrarModalCatalogo() {
    document.getElementById("modal-catalogo").classList.remove("open");
    _resetModalCatalogo();
}

function detectarMaterial(nombre) {
    const n = (nombre || "").toLowerCase();
    if (n.includes("oro laminado") || n.includes("plata 925 + oro")) return "Plata 925 + Oro Laminado";
    if (n.includes("plata fina") || n.includes("plata 925"))         return "Plata Fina 925";
    if (n.includes("acero"))                                          return "Acero 316L";
    if (n.includes("reloj"))                                          return "Reloj";
    return "";
}

function _actualizarResumenVariado() {
    const box = document.getElementById("cat-var-resumen");
    if (!box) return;
    const talla  = document.getElementById("cat-talla")?.value || "";
    const genero = document.getElementById("cat-genero")?.value || "";
    const tipoAN = document.getElementById("cat-tipo-an")?.value || "";
    const pfx    = (document.getElementById("cat-prefijo-txt")?.value || "").trim();
    const cats   = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);

    const partes = [];
    if (cats.length) partes.push(`Solo: ${cats.map(k => CAT_MAP[k]).join(", ")}`);
    const ocs = ocasionesSeleccionadas();
    if (ocs.length) partes.push(`Ocasión: ${ocs.map(id => ocasionesLista(true).find(o => o.id === id)?.nombre || id).join(" / ")}`);
    const hasAN = cats.length === 0 || cats.includes("AN");
    if (hasAN) {
        if (talla)  partes.push(`Anillos → Talla ${_tallasDisplay(talla)}`);
        if (genero) partes.push(`Anillos → ${genero === "dama" ? "Dama" : "Caballero"}`);
        if (tipoAN) partes.push(`Anillos → ${tipoAN === "pareja" ? "Pareja/Argolla" : "Sencillos"}`);
        if (pfx)    partes.push(`Anillos → Prefijo ${pfx}`);
    }

    if (!partes.length) {
        box.style.display = "none";
        return;
    }
    box.style.display = "block";
    box.innerHTML = `🎯 <strong>Auto-seleccionar variado</strong> respetará: ${partes.join(" · ")}. El resto de categorías se incluyen sin restricción.`;
}

// Selección múltiple de talla al generar catálogo — antes solo se podía
// elegir una sola talla (dropdown), pero un cliente puede necesitar ver
// varias tallas juntas (ej. 6.5 y 7) en el mismo link. El valor real se
// guarda en el input oculto #cat-talla como texto separado por comas
// ("6.5,7"), para no tener que tocar los demás lugares del código que ya
// leen su .value.
const TALLAS_CATALOGO = ["5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","10.5","11","12","13","14"];
function _pintarChipsTalla() {
    const cont = document.getElementById("cat-talla-chips");
    if (!cont || cont.children.length) return;
    cont.innerHTML = TALLAS_CATALOGO.map(t => `<button type="button" class="cat-talla-chip" data-talla="${t}" onclick="toggleCatTallaChip('${t}',this)"
        style="padding:6px 11px;border-radius:16px;border:1.5px solid var(--borde);background:#fff;color:#111;font-size:12px;font-weight:700;cursor:pointer;">T${t}</button>`).join("")
        + `<button type="button" onclick="limpiarCatTallaChips()" style="padding:6px 11px;border-radius:16px;border:none;background:#eee;color:#666;font-size:12px;font-weight:700;cursor:pointer;">✕ Todas</button>`;
}

function toggleCatTallaChip(t, btn) {
    const inp = document.getElementById("cat-talla");
    const actuales = inp.value ? inp.value.split(",") : [];
    const idx = actuales.indexOf(t);
    if (idx >= 0) { actuales.splice(idx, 1); btn.style.background = "#fff"; btn.style.color = "#111"; btn.style.borderColor = "var(--borde)"; }
    else { actuales.push(t); btn.style.background = "var(--azul)"; btn.style.color = "#fff"; btn.style.borderColor = "var(--azul)"; }
    inp.value = actuales.join(",");
    filtrarParaCatalogo();
}

function limpiarCatTallaChips() {
    document.getElementById("cat-talla").value = "";
    document.querySelectorAll(".cat-talla-chip").forEach(b => { b.style.background = "#fff"; b.style.color = "#111"; b.style.borderColor = "var(--borde)"; });
    filtrarParaCatalogo();
}

// Repinta los chips activos según el valor actual del input oculto — hace
// falta llamarla cada vez que #cat-talla.value se asigna desde código (recetas
// guardadas, reset del modal) en vez de por clic directo en un chip.
function sincronizarChipsCatTalla() {
    _pintarChipsTalla();
    const seleccionadas = (document.getElementById("cat-talla")?.value || "").split(",").filter(Boolean);
    document.querySelectorAll(".cat-talla-chip").forEach(b => {
        const activa = seleccionadas.includes(b.dataset.talla);
        b.style.background = activa ? "var(--azul)" : "#fff";
        b.style.color = activa ? "#fff" : "#111";
        b.style.borderColor = activa ? "var(--azul)" : "var(--borde)";
    });
}

// Texto legible para mostrar en resúmenes/subtítulos ("6.5, 7" en vez de "6.5,7")
function _tallasDisplay(tallaCsv) {
    return (tallaCsv || "").split(",").filter(Boolean).join(", ");
}

function filtrarParaCatalogo() {
    const talla  = document.getElementById("cat-talla").value;
    const genero = document.getElementById("cat-genero").value;
    const cont   = document.getElementById("cat-lista");
    const info   = document.getElementById("cat-info");
    const cats   = [...document.querySelectorAll(".cat-cat-chk:checked")].map(c => c.value);
    const hasAN  = cats.length === 0 || cats.includes("AN");
    _actualizarResumenVariado();

    let lista = cats.length
        ? productos.filter(p => cats.includes(getCatKey(p)))
        : [...productos];

    // Excluir productos marcados como Reservados en Consignación — no deben ofrecerse en ningún catálogo
    lista = lista.filter(p => !p.reservado);

    // Excluir productos sin stock disponible en BODEGA — una pieza ya entregada
    // a un vendedor en consignación (o puesta en tienda) no debe volver a
    // ofrecerse para armar un catálogo nuevo, aunque globalmente no esté agotada
    lista = lista.filter(p => _stockBodegaProd(p) > 0);

    // Filtro de ocasión — aplica a TODAS las categorías. Varias marcadas = la
    // pieza entra si tiene cualquiera de ellas (ej. 15 años O compromiso).
    const ocasionesFiltro = ocasionesSeleccionadas();
    if (ocasionesFiltro.length) {
        lista = lista.filter(p => _ocasionesDeFila(p).some(o => ocasionesFiltro.includes(o)));
    }

    // Filtro de precio (tarjetas del paso 2 o lo que entendió la IA) — aplica a todo.
    if (_catPrecio.min > 0) lista = lista.filter(p => parseFloat(p.precio || 0) >= _catPrecio.min);
    if (_catPrecio.max > 0) lista = lista.filter(p => parseFloat(p.precio || 0) <= _catPrecio.max);

    // Buscador por nombre o código.
    const q = _normTxt((document.getElementById("cat-buscar")?.value || "").trim());
    if (q) lista = lista.filter(p => [p.nombre, p.nombre_base, p.codigo, p.codigoBase].some(x => _normTxt(x).includes(q)));

    // Filtro de material — aplica a TODAS las categorías, no solo Anillos.
    // Se puede marcar más de uno (ej. plata Y acero) — sin selección = todos.
    const materialesFiltro = [...document.querySelectorAll(".cat-material-chk:checked")].map(c => c.value);
    if (materialesFiltro.length) {
        lista = lista.filter(p => {
            const m = (p.material || detectarMaterial(p.nombre) || "").toLowerCase();
            return materialesFiltro.some(materialFiltro => {
                if (materialFiltro === "plata")  return m.includes("plata") && !m.includes("oro");
                if (materialFiltro === "acero")  return m.includes("acero");
                if (materialFiltro === "oro")    return m.includes("oro");
                return false;
            });
        });
    }

    // Filtro por prefijo (C, D, U...) — solo aplica a AN
    const pfxTxt = (document.getElementById("cat-prefijo-txt")?.value||"").toUpperCase();
    const pfxSel = pfxTxt.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
    if (hasAN && pfxSel.length) {
        lista = lista.filter(p => getCatKey(p) !== "AN" || pfxSel.includes(getPrefijoProd(p)));
    }

    const tipoAN = document.getElementById("cat-tipo-an").value;
    if (hasAN && tipoAN) {
        lista = lista.filter(p => {
            if (getCatKey(p) !== "AN") return true;
            let s = {};
            try { s = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
            const esPareja = Object.keys(s).some(k => k.startsWith("D") || k.startsWith("H"))
                || /matrimonio|argolla|novios|pareja|alianza/i.test(p.nombre || "");
            return tipoAN === "pareja" ? esPareja : !esPareja;
        });
    }

    const tieneTalla = (p, t) => {
        // Consignación: campo "talla" plano por registro (una fila = una talla específica) — fuente de verdad.
        // Si existe y NO coincide, la fila es de otra talla: se descarta de inmediato sin caer al respaldo
        // (el respaldo por substring del código puede dar falsos positivos, ej. "T6" dentro de "DT6"/"CT16").
        if (p.talla !== undefined && p.talla !== null && String(p.talla).trim() !== "") {
            if (String(p.talla) !== String(t)) return false;
            if (!genero) return true;
            const n = (p.nombre || "").toLowerCase();
            // El filtro de Género solo aplica a sets de pareja (matrimonio/argolla/alianza) —
            // un anillo simple/unisex no lleva "dama"/"caballero" en el nombre y no debe excluirse por esto.
            const esParejaRow = /matrimonio|argolla|novios|pareja|alianza/i.test(p.nombre || "");
            if (!esParejaRow) return true;
            if (genero === "dama")      return /\bdama\b|\bmujer\b/.test(n);
            if (genero === "caballero") return /\bcaballero\b|\bhombre\b/.test(n);
            return true;
        }
        // Admin (Nuevo Producto): JSON de tallas agregado en un solo registro (solo si no hay campo talla plano)
        let s = {};
        try { s = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
        if (genero === "dama")      return (s["D" + t] || 0) > 0;
        if (genero === "caballero") return (s["H" + t] || 0) > 0;
        if ((s[t] || 0) > 0 || (s["D" + t] || 0) > 0 || (s["H" + t] || 0) > 0) return true;
        const cod = (p.codigo || "").toUpperCase();
        return cod.includes("T" + t) || cod.includes("T0" + t);
    };

    const tallasFiltro = (talla || "").split(",").filter(Boolean);
    if (hasAN && tallasFiltro.length) {
        lista = lista.filter(p => getCatKey(p) !== "AN" || tallasFiltro.some(t => tieneTalla(p, t)));
    }

    // Agrupar anillos; dejar el resto sin agrupar
    const anLista    = lista.filter(p => getCatKey(p) === "AN");
    const otherLista = lista.filter(p => getCatKey(p) !== "AN");
    if (lista.length) console.log("[VEREX] campos producto:", Object.keys(lista[0]), "| caractEspecial:", lista[0].caractEspecial, "| getNotaEspecial:", getNotaEspecial(lista[0]));
    lista = [...agruparParaCatalogo(anLista), ...otherLista];

    _catFiltrada = lista;
    info.textContent = `${lista.length} pieza${lista.length === 1 ? "" : "s"}`;

    if (!lista.length) {
        cont.innerHTML = `<div style="color:#888;font-size:13px;text-align:center;padding:28px;border:1.5px dashed var(--borde);border-radius:12px;">
            No hay piezas con estos filtros. Quita alguno arriba con ✕${ocasionesFiltro.length ? ", o etiqueta más piezas con 🏷️ Etiquetar productos (paso 1)" : ""}.</div>`;
        return;
    }

    const cards = lista.map(p => {
        let stockLabel = "";
        try {
            const s = JSON.parse(p.caracteristicas || "{}");
            if (tallasFiltro.length) {
                const esPareja = Object.keys(s).some(k => k.startsWith("D") || k.startsWith("H"));
                if (esPareja) {
                    const d = tallasFiltro.reduce((sum, t) => sum + (s["D" + t] || 0), 0);
                    const h = tallasFiltro.reduce((sum, t) => sum + (s["H" + t] || 0), 0);
                    stockLabel = [d > 0 ? `D:${d}` : "", h > 0 ? `C:${h}` : ""].filter(Boolean).join(" ");
                } else {
                    const q = tallasFiltro.reduce((sum, t) => sum + (s[t] || 0), 0);
                    stockLabel = q > 0 ? `Stock:${q}` : "";
                }
            }
        } catch(_) {}

        const img  = ikSharp(p.foto || p.img || "");
        const mat  = p.material || detectarMaterial(p.nombre);
        const cod0 = p._codigos?.[0] || p.codigo;
        const ocEmojis = ocasionesDeProd(p).map(id => ocasionesLista(true).find(o => o.id === id)).filter(Boolean)
            .map(o => `<span title="${esc(o.nombre)}">${esc(o.emoji || "🏷️")}</span>`).join("");
        const sizesHtml = p._sizes?.length
            ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:2px;">${p._sizes.map(sz =>
                `<span style="padding:1px 5px;background:#e8f4fd;border-radius:4px;font-size:9px;font-weight:700;color:#0277bd;">T${sz}</span>`
              ).join("")}</div>`
            : "";
        return `<div class="wz-prod">
            <label style="cursor:pointer;display:block;flex:1;margin:0;text-transform:none;letter-spacing:0;">
                <div style="position:relative;aspect-ratio:1/1;background:#f5f5f5;">
                    ${img
                        ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none'">`
                        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;color:#ccc;">💍</div>`
                    }
                    <input type="checkbox" class="cat-chk" data-cod="${cod0}" checked>
                </div>
                <div style="padding:8px 10px;">
                    <div style="font-weight:700;font-size:13px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#1a1a1a;">${esc(p.nombre || "—")}</div>
                    <div style="font-size:13px;font-weight:800;color:#0098cc;margin-top:2px;">$${parseFloat(p.precio || 0).toFixed(2)}</div>
                    ${mat ? `<div style="font-size:10px;color:#7c3aed;font-weight:600;">${mat}</div>` : ""}
                    ${ocEmojis ? `<div style="font-size:12px;margin-top:2px;letter-spacing:1px;">${ocEmojis}</div>` : ""}
                    ${sizesHtml}
                    ${stockLabel ? `<div style="font-size:10px;color:#0277bd;background:#e8f4fd;padding:1px 5px;border-radius:4px;display:inline-block;margin-top:2px;">${stockLabel}</div>` : ""}
                    ${getNotaEspecial(p) ? `<div style="font-size:9px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:1px 5px;margin-top:2px;font-weight:700;">♦ ${getNotaEspecial(p)}</div>` : ""}
                </div>
            </label>
            <input type="text" class="cat-nota" data-cod="${cod0}"
                placeholder="✎ Nota visible en la pieza (opcional)"
                style="width:100%;padding:6px 9px !important;border:none;border-top:1px solid var(--borde);font-size:11.5px !important;background:#fffdf5;font-family:inherit;box-sizing:border-box;">
        </div>`;
    }).join("");
    cont.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">${cards}</div>`;
}

function seleccionarTodosCatalogo(sel) {
    document.querySelectorAll(".cat-chk").forEach(c => c.checked = sel);
}

function generarIdAfiliado(nombre) {
    const id = nombre.toLowerCase()
        .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
        .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u').replace(/ñ/g,'n')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const el = document.getElementById('cat-afiliado-id');
    if (el) el.value = id;
}

// Solo lo que hay físicamente en BODEGA — a diferencia de _stockTotalProd
// (que suma bodega+tienda+consignación, correcto para saber si algo está
// "agotado" en general), esto es lo que importa al armar un catálogo NUEVO:
// una pieza ya entregada a un vendedor en consignación no está disponible
// para ofrecerla a otro cliente, aunque globalmente no esté "agotada".
function _stockBodegaProd(p) {
    if (Array.isArray(p._codigos) && p._codigos.length > 1) {
        return p._codigos.reduce((acc, cod) => {
            const row = productos.find(x => x.codigo === cod);
            return acc + (row ? _stockBodegaProd(row) : 0);
        }, 0);
    }
    let s = {};
    try { s = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
    const totalJSON = Object.values(s).reduce((a, b) => a + (parseInt(b) || 0), 0);
    if (totalJSON > 0) return totalJSON; // producto "Nuevo Producto" del admin — no maneja bodega/consig por separado
    return parseInt(p.stock_bodega) || 0;
}

function _stockTotalProd(p) {
    // Grupo con varias tallas fusionadas (ej. anillo con una fila por talla) — sumar el stock real de cada fila
    if (Array.isArray(p._codigos) && p._codigos.length > 1) {
        return p._codigos.reduce((acc, cod) => {
            const row = productos.find(x => x.codigo === cod);
            return acc + (row ? _stockTotalProd(row) : 0);
        }, 0);
    }
    // Admin (Nuevo Producto): JSON de tallas agregado en un solo registro
    let s = {};
    try { s = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
    const totalJSON = Object.values(s).reduce((a, b) => a + (parseInt(b) || 0), 0);
    if (totalJSON > 0) return totalJSON;
    // Consignación: stock repartido en campos planos por registro (una fila = una talla/unidad)
    return (parseInt(p.stock_bodega)||0) + (parseInt(p.stock_tienda)||0) + (parseInt(p.stock_consignacion)||0);
}

// evitarCodigos (opcional): códigos que se prefiere NO repetir (ej. lo que ya
// se mostró el mes pasado a este afiliado) — se usan solo como preferencia,
// si no hay suficiente variedad con stock se completa repitiéndolos igual.
// Sube o baja de 10 en 10 el tamaño del catálogo variado — para mandar un
// catálogo más grande basta con darle "+10" las veces que haga falta.
function ajustarTamanoCatalogo(delta) {
    const inp = document.getElementById("cat-var-size");
    if (!inp) return;
    const actual = parseInt(inp.value) || 36;
    inp.value = Math.max(10, actual + delta);
    onCambiarTamanoCatalogo();
}

// El campo de cantidad (y los botones -10/+10) solo tenían efecto si después
// se volvía a presionar "Auto-seleccionar variado" a mano — si no, el link se
// generaba con lo que estuviera marcado, sin respetar el número del campo.
// Ahora, si ya había una selección previa (algo marcado), cambiar el número
// vuelve a correr la auto-selección sola, para que el campo siempre sea
// exactamente lo que se va a generar.
function onCambiarTamanoCatalogo() {
    const haySeleccionPrevia = document.querySelectorAll(".cat-chk:checked").length > 0;
    if (haySeleccionPrevia) autoSeleccionarVariado();
}

// Historial global de variedad: cuándo se le mostró por última vez cada
// código a CUALQUIER afiliado (no solo al que se está editando ahora), para
// repartir la variedad del inventario entre todos los afiliados en vez de que
// cada uno solo evite repetirse a sí mismo. Se cachea en memoria por sesión.
let _variedadGlobalCache = null;
async function cargarVariedadGlobal() {
    if (_variedadGlobalCache) return _variedadGlobalCache;
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ accion: "GET_VARIEDAD_CATALOGO_GLOBAL", _pass: ADMIN_PASS }) });
        const data = await res.json();
        _variedadGlobalCache = data.codigos || {};
    } catch(_) { _variedadGlobalCache = {}; }
    return _variedadGlobalCache;
}

// A diferencia de autoSeleccionarVariado() (que arma una MEZCLA fija de
// categorías sin importar los filtros de arriba), esto elige N al azar
// SOLO de lo que ya quedó después de aplicar Categoría/Material/Talla —
// para cuando el pedido es literal: "quiero 50 aretes de plata", no una
// mezcla variada de todo tipo de joyería.
function elegirAzarFiltrado() {
    const chks = [...document.querySelectorAll(".cat-chk")];
    if (!chks.length) { toast("⚠️ No hay productos con los filtros actuales", "#f97316"); return; }
    const n = parseInt(document.getElementById("cat-var-size")?.value) || 36;

    chks.forEach(c => c.checked = false);
    // Fisher-Yates
    const shuffled = [...chks];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.slice(0, n).forEach(c => c.checked = true);
    toast(`🎲 ${Math.min(n, chks.length)} producto(s) elegidos al azar`, "#22c55e");
}

async function autoSeleccionarVariado(evitarCodigos) {
    const evitar = evitarCodigos instanceof Set ? evitarCodigos : new Set(evitarCodigos || []);
    const variedadGlobal = await cargarVariedadGlobal();
    const TOTAL = parseInt(document.getElementById("cat-var-size")?.value) || 36;
    // Proporción base (sobre 36) — se escala al tamaño elegido. Dentro de
    // Anillos se separa "simples" de "alianzas/pares/tríos" con un tope fijo,
    // porque un grupo de pareja suma el stock de varias filas (dama+caballero+
    // tallas) y por pura cantidad de stock terminaba ganando casi todos los
    // cupos de Anillos, dejando el catálogo dominado por alianzas.
    // Acero 316L es línea secundaria/económica: se fija una proporción 80/20
    // (plata / acero) sobre el total elegido — a 10 productos son 8 plata + 2
    // acero, a 50 son 40 + 10, y así sucesivamente — en vez de repartirse por
    // categoría, porque un producto de acero puede ser AN, AR, CD o PL.
    const esAcero = p => /acero/i.test(p.material || "") || /acero/i.test(p.nombre || "");
    const ACERO_QUOTA = Math.round(TOTAL * 0.2);
    const PLATA_TOTAL = TOTAL - ACERO_QUOTA;

    // Dentro de Anillos se separa en TRES baldes, no dos: pares/tríos
    // estructurales (dama+caballero), alianzas vendidas como pieza individual
    // unisex (mismo diseño de alianza pero sin par armado), y anillos normales
    // (solitarios y demás). Sin este tercer balde, las alianzas individuales
    // caían junto con los anillos normales en "AN_simple" y, al haber mucho
    // más stock de alianzas, terminaban ganando casi todos esos cupos.
    const ES_ALIANZA_NOM = /matrimonio|argolla|novios|pareja|alianza/i;
    const esAlianzaIndividual = p => !p._esPareja && ES_ALIANZA_NOM.test(p.nombre || "");

    const DIST_BASE = { AN_simple: 8, AN_alianza: 2, AN_pareja: 5, AR: 9, CD: 5, PL: 5 };
    const DIST_SUM  = Object.values(DIST_BASE).reduce((a, b) => a + b, 0); // 34
    const DIST = {};
    Object.entries(DIST_BASE).forEach(([cat, n]) => { DIST[cat] = Math.round(n * PLATA_TOTAL / DIST_SUM); });

    // En catálogos de afiliado se limita aún más: máximo 3 alianzas EN TOTAL
    // (pares, tríos o pieza individual, todas juntas), sin importar el tamaño
    // del catálogo — el afiliado vende de todo, no solo alianzas. Se maneja
    // aparte de los baldes normales (más abajo) para que el tope sea sobre la
    // suma de ambos baldes, no sobre cada uno por separado.
    const esCatalogoAfiliado = document.getElementById("cat-es-afiliado")?.checked || false;
    const ALIANZA_TOTAL_CAP = 3;
    if (esCatalogoAfiliado) { delete DIST.AN_pareja; delete DIST.AN_alianza; }

    const porCat = {};
    _catFiltrada.filter(p => !esAcero(p)).forEach(p => {
        const catRaw = p._catKey || getCatKey(p);
        const cat = catRaw !== "AN" ? catRaw
            : p._esPareja           ? "AN_pareja"
            : esAlianzaIndividual(p)? "AN_alianza"
            :                          "AN_simple";
        if (!porCat[cat]) porCat[cat] = [];
        porCat[cat].push(p);
    });

    // Orden: 1) primero lo NO mostrado antes a ESTE afiliado (variedad propia),
    // 2) luego lo menos mostrado recientemente a CUALQUIER afiliado (variedad
    // compartida — evita que 10 afiliados con el mismo stock reciban siempre
    // el mismo catálogo), 3) y dentro de eso, mayor stock primero.
    const cmp = (a, b) => {
        const codA = a._codigos?.[0] || a.codigo, codB = b._codigos?.[0] || b.codigo;
        const evA = evitar.has(codA) ? 1 : 0, evB = evitar.has(codB) ? 1 : 0;
        if (evA !== evB) return evA - evB;
        const tsA = variedadGlobal[codA] || 0, tsB = variedadGlobal[codB] || 0;
        if (tsA !== tsB) return tsA - tsB;
        return _stockTotalProd(b) - _stockTotalProd(a);
    };
    Object.values(porCat).forEach(arr => arr.sort(cmp));

    // Reparte la selección de una lista en 3 bandas de precio (bajo/medio/alto)
    // en vez de tomar simplemente los `count` de mayor stock — sin esto, si las
    // piezas más caras de una categoría (ej. pulseras) resultan tener más stock,
    // el catálogo terminaba mostrando solo las caras, sin variedad de precio.
    // Dentro de cada banda se sigue respetando el orden de variedad/stock (cmp).
    function _seleccionarDiversoPrecio(lista, count) {
        if (lista.length <= count) return lista.slice();
        const porPrecio = lista.slice().sort((a, b) => parseFloat(a.precio || 0) - parseFloat(b.precio || 0));
        const n = porPrecio.length;
        const bandas = [
            porPrecio.slice(0, Math.ceil(n / 3)),
            porPrecio.slice(Math.ceil(n / 3), Math.ceil(2 * n / 3)),
            porPrecio.slice(Math.ceil(2 * n / 3)),
        ].map(b => b.sort(cmp));
        const out = [];
        let i = 0;
        while (out.length < count && bandas.some(b => b.length)) {
            const banda = bandas[i % 3];
            if (banda.length) out.push(banda.shift());
            i++;
        }
        return out;
    }

    const selected = new Set();

    // Reservar primero la cuota de acero (prioriza variedad + stock igual que las demás)
    _seleccionarDiversoPrecio(_catFiltrada.filter(esAcero), ACERO_QUOTA)
        .forEach(p => selected.add(p._codigos?.[0] || p.codigo));

    // Catálogo de afiliado: cupo combinado de alianzas (pares+tríos+individuales
    // juntos), tope fijo de 3 sin importar el tamaño del catálogo.
    if (esCatalogoAfiliado) {
        _seleccionarDiversoPrecio([...(porCat.AN_pareja || []), ...(porCat.AN_alianza || [])], ALIANZA_TOTAL_CAP)
            .forEach(p => selected.add(p._codigos?.[0] || p.codigo));
    }

    // Seleccionar por distribución principal, priorizando variedad y diversidad
    // de precio (se descuenta lo que ya ocupó la cuota de acero para no
    // pasarse del total)
    Object.entries(DIST).forEach(([cat, count]) => {
        const disponibles = (porCat[cat] || []).filter(p => !selected.has(p._codigos?.[0] || p.codigo));
        _seleccionarDiversoPrecio(disponibles, count).forEach(p => selected.add(p._codigos?.[0] || p.codigo));
    });

    // Completar con otras categorías si hay espacio (mismo criterio) — en
    // catálogo de afiliado, AN_pareja/AN_alianza ya se manejaron arriba con su
    // propio tope combinado, así que se excluyen aquí para no colarse sin límite.
    let restante = TOTAL - selected.size;
    Object.keys(porCat).filter(c => !DIST[c] && !(esCatalogoAfiliado && (c === "AN_pareja" || c === "AN_alianza"))).forEach(cat => {
        if (restante <= 0) return;
        (porCat[cat] || []).forEach(p => {
            if (restante <= 0) return;
            selected.add(p._codigos?.[0] || p.codigo);
            restante--;
        });
    });

    // Si aún falta (categorías principales no tenían suficiente stock), completar
    // con lo que sobre de cualquier categoría — PERO en dos pasadas: primero todo
    // lo que NO sea pareja/trío (para no dejar que las alianzas, que siempre
    // ganan por stock acumulado, se coman este relleno), y solo si de verdad no
    // alcanza, se recurre a más pareja/trío al final.
    if (selected.size < TOTAL) {
        const esParejaTrio = p => (p._catKey || getCatKey(p)) === "AN" && (p._esPareja || esAlianzaIndividual(p));
        _catFiltrada.slice().sort(cmp).filter(p => !esParejaTrio(p)).forEach(p => {
            if (selected.size >= TOTAL) return;
            selected.add(p._codigos?.[0] || p.codigo);
        });
        if (selected.size < TOTAL) {
            _catFiltrada.slice().sort(cmp).filter(esParejaTrio).forEach(p => {
                if (selected.size >= TOTAL) return;
                selected.add(p._codigos?.[0] || p.codigo);
            });
        }
    }

    document.querySelectorAll(".cat-chk").forEach(c => { c.checked = selected.has(c.dataset.cod); });
    const count = document.querySelectorAll(".cat-chk:checked").length;
    const nuevos = [...selected].filter(c => !evitar.has(c)).length;
    toast(evitar.size
        ? `✅ ${count} productos seleccionados (${nuevos} nuevos vs. la última vez, prioriza variedad + stock)`
        : `✅ ${count} productos seleccionados automáticamente (variado, prioriza mayor stock)`, "#22c55e");
}

// Las fotos se suben tal cual las manda el vendedor, sin ningún realce —
// esto le agrega nitidez (e-sharpen) de ImageKit solo al mostrarla, sin
// tocar la foto guardada.
function ikSharp(url) {
    if (!url || !url.includes("imagekit.io")) return url;
    if (url.includes("e-sharpen") || /,q-90(?=,|$)/.test(url)) return url;   // foto ya mejorada (también el nivel Suave, sin e-sharpen): sumar otra nitidez la hacía verse exagerada
    return url.includes("?tr=") ? url + ",e-sharpen" : url + "?tr=e-sharpen";
}
