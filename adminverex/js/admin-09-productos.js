// Admin VEREX — Productos, envío y cupones
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  PRODUCTOS
// ═════════════════════════════════════════════
function renderProductos() {
    const busq = document.getElementById("bus-prod").value.toLowerCase();
    const cont = document.getElementById("lista-prod");
    const list = productos.filter(p=>!busq||(p.nombre||"").toLowerCase().includes(busq)||(p.codigo||"").toLowerCase().includes(busq));
    if (!list.length) { cont.innerHTML='<p style="color:#aaa;font-size:13px;">Sin productos.</p>'; return; }
    cont.innerHTML = list.map(p=>{
        let stock="";
        try {
            const s = JSON.parse(p.caracteristicas||"{}");
            const t = Object.values(s).reduce((a,b)=>a+Number(b),0);
            if (t > 0) { stock = `Stock: ${t}`; }
            else {
                // Fallback: usar contadores reales de stock
                const total = (parseInt(p.stock_bodega)||0) + (parseInt(p.stock_tienda)||0) + (parseInt(p.stock_consignacion)||0);
                stock = total > 0 ? `Stock: ${total}` : `<span style="color:var(--rojo)">Agotado</span>`;
            }
        } catch(_){ stock="Sin tallas"; }
        const dest = p.destacado===true||p.destacado==="TRUE";
        return `<div class="pc">
            <img src="${ikSharp(p.fotoMejorada||p.foto||p.img||'')}" alt="" onerror="this.style.display='none'">
            <div class="pi">
                <div class="pn">${p.nombre||"—"} ${dest?'<span class="badge bam2">⭐ Destacado</span>':''}</div>
                <div class="pd">Ref: ${p.codigo||"—"} · $${parseFloat(p.precio||0).toFixed(2)} · ${stock}${getNotaEspecial(p)?` · <span style="color:#92400e;background:#fef3c7;border-radius:3px;padding:0 4px;font-size:10px;">♦ ${getNotaEspecial(p)}</span>`:''}</div>
            </div>
            <div class="pa">
                <button class="btn bg" onclick='abrirEditar(${JSON.stringify(p)})'>✏️</button>
                <button class="btn bg" onclick='abrirMejorarFoto(${JSON.stringify(p)})' title="Mejorar imagen / Enhance image">✨</button>
                <button class="btn ${dest?'bam':'bg'}" onclick="toggleDest('${p.codigo}',${!dest})" title="${dest?'Quitar':'Marcar'} destacado">⭐</button>
            </div>
        </div>`;
    }).join('');
}

function abrirEditar(p) {
    document.getElementById("ed-cod").value  = p.codigo;
    document.getElementById("ed-nom").value  = p.nombre;
    document.getElementById("ed-prec").value = p.precio;
    document.getElementById("ed-img").value  = p.foto || p.img || "";
    document.getElementById("ed-caract-especial").value = getNotaEspecial(p);

    // Mostrar tallas solo para anillos
    const esAnillo = (p.codigo || "").startsWith("AN-");
    const secTallas = document.getElementById("ed-sec-tallas");
    secTallas.style.display = esAnillo ? "block" : "none";
    document.getElementById("ed-es-anillo").value = esAnillo ? "1" : "0";

    // Rellenar inputs de tallas con stock actual
    if (esAnillo) {
        let stocks = {};
        try { stocks = JSON.parse(p.caracteristicas || "{}"); } catch(_) {}
        // Detectar si es pareja por claves D* o H*
        const esPareja = Object.keys(stocks).some(k => k.startsWith("D") || k.startsWith("H"));
        document.getElementById("ed-sec-simple").style.display = esPareja ? "none"  : "block";
        document.getElementById("ed-sec-pareja").style.display = esPareja ? "block" : "none";
        document.getElementById("ed-es-anillo").value = esPareja ? "pareja" : "1";
        if (esPareja) {
            document.querySelectorAll(".ed-ts-d").forEach(i => { i.value = stocks[i.dataset.t] || 0; });
            document.querySelectorAll(".ed-ts-h").forEach(i => { i.value = stocks[i.dataset.t] || 0; });
        } else {
            document.querySelectorAll(".ed-ts").forEach(i => { i.value = stocks[i.dataset.t] || 0; });
        }
    }

    document.getElementById("modal-edit").classList.add("open");
}
function cerrarModal() { document.getElementById("modal-edit").classList.remove("open"); }

async function guardarEdicion() {
    // Leer stock desde inputs visuales si es anillo
    let caracteristicas = undefined;
    const edTipo = document.getElementById("ed-es-anillo").value;
    if (edTipo === "1" || edTipo === "pareja") {
        const stocks = {};
        if (edTipo === "pareja") {
            document.querySelectorAll(".ed-ts-d").forEach(i => { const v=parseInt(i.value); if(v>0) stocks[i.dataset.t]=v; });
            document.querySelectorAll(".ed-ts-h").forEach(i => { const v=parseInt(i.value); if(v>0) stocks[i.dataset.t]=v; });
        } else {
            document.querySelectorAll(".ed-ts").forEach(inp => { const v=parseInt(inp.value); if(v>0) stocks[inp.dataset.t]=v; });
        }
        caracteristicas = JSON.stringify(stocks);
    }

    const caractEspecial = document.getElementById("ed-caract-especial").value.trim();
    const datos = {
        accion: "EDITAR_PRODUCTO", _pass: ADMIN_PASS,
        codigo: document.getElementById("ed-cod").value,
        nombre: document.getElementById("ed-nom").value,
        precio: document.getElementById("ed-prec").value,
        img:    document.getElementById("ed-img").value,
        caractEspecial,
        ...(caracteristicas !== undefined && { caracteristicas }),
    };
    await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(datos)});
    cerrarModal(); toast("✅ Producto actualizado","#22c55e");
    await cargarDatos(true);
}

async function desactivarProducto() {
    const cod=document.getElementById("ed-cod").value;
    if (!confirm(`¿Desactivar ${cod}?`)) return;
    await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:"ELIMINAR_PRODUCTO",_pass:ADMIN_PASS,codigo:cod})});
    cerrarModal(); toast("🗑️ Producto desactivado");
    await cargarDatos(true);
}

async function toggleDest(codigo, destacado) {
    await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:"EDITAR_PRODUCTO",_pass:ADMIN_PASS,codigo,destacado})});
    toast(destacado?"⭐ Marcado como destacado":"Quitado de destacados");
    await cargarDatos(true);
}

// Nuevo producto
function togglePareja() {
    const esPareja = document.getElementById("chk-pareja").checked;
    document.getElementById("sec-talla-simple").style.display = esPareja ? "none" : "block";
    document.getElementById("sec-talla-pareja").style.display = esPareja ? "block" : "none";
}

function actualizarNombre() {
    const t=document.getElementById("sel-tipo"); if(!t) return;
    const pref = t.value;
    const tipo = t.options[t.selectedIndex].text.split(" ")[0]; // "Anillo", "Aretes", etc.
    const mat  = document.getElementById("sel-mat").value;
    const det  = (document.getElementById("in-det")||{}).value.trim()||"";
    // Nombre: Tipo + Característica + Material  (ej: "Anillo Mariposa Plata Fina 925")
    const partes = [tipo, det, mat].filter(Boolean);
    document.getElementById("out-nom").textContent = partes.join(" ");
    // Código = el mismo que genera Stock (categoría + material + siguiente número libre, p. ej. ANP175), porque de ahí sale la
    // etiqueta. Antes se inventaba uno al azar («CN-4821») que no coincidía con Stock ni con las categorías de la tienda.
    const clave = pref + "|" + mat;
    if (window._cClave !== clave) {
        window._cClave = clave; window._c = null;
        document.getElementById("out-cod").textContent = "calculando…";
        fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "GENERAR_CODIGO", categoria: pref, material: mat }) })
            .then(r => r.json()).then(r => {
                if (window._cClave !== clave) return;               // cambió el tipo/material mientras tanto
                if (r && r.ok && r.codigo) { window._c = r.codigo; document.getElementById("out-cod").textContent = r.codigo; }
                else document.getElementById("out-cod").textContent = "⚠️ no se pudo generar";
            }).catch(() => { if (window._cClave === clave) document.getElementById("out-cod").textContent = "⚠️ sin conexión"; });
    }
    // Tallas solo para Anillos
    document.getElementById("sec-tallas").style.display = pref==="AN" ? "block" : "none";
}

async function publicarProducto() {
    const nombre=document.getElementById("out-nom").textContent;
    const precio=document.getElementById("in-prec").value;
    const img=document.getElementById("in-img").value.trim();
    const codigo=window._c||"";
    if (!codigo) return toast("⚠️ Espera a que se genere el código (o revisa la conexión)","#f97316");
    if (!precio||!img) return toast("⚠️ Falta precio o imagen","#f97316");
    const esPareja = document.getElementById("chk-pareja")?.checked;
    const stocks = {};
    if (esPareja) {
        // Guardar tallas dama (D5-D14) y caballero (H5-H14)
        document.querySelectorAll(".ts-d").forEach(i => { const v=parseInt(i.value); if(v>0) stocks[i.dataset.t]=v; });
        document.querySelectorAll(".ts-h").forEach(i => { const v=parseInt(i.value); if(v>0) stocks[i.dataset.t]=v; });
    } else {
        document.querySelectorAll(".ts").forEach(i => { const v=parseInt(i.value); if(v>0) stocks[i.dataset.t]=v; });
    }
    const btn=document.querySelector("#tab-2 .bfull");
    btn.textContent="Publicando..."; btn.disabled=true;
    try {
        const rp = await (await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:"CREAR_PRODUCTO",_pass:ADMIN_PASS,nombre,precio,img,codigo,categoria:document.getElementById("sel-tipo").value,material:document.getElementById("sel-mat").value,caracteristicas:JSON.stringify(stocks)})})).json();
        if (!rp || rp.ok === false) { toast("❌ "+((rp && rp.error)||"No se pudo publicar"),"#ef4444"); window._c=null; window._cClave=null; actualizarNombre(); return; }
        toast("✅ Producto publicado","#22c55e");
        document.getElementById("in-prec").value=document.getElementById("in-img").value=document.getElementById("in-det").value="";
        document.querySelectorAll(".ts").forEach(i=>i.value=0);
        window._c=null; window._cClave=null;   // fuerza pedir el siguiente código libre
        const chkP = document.getElementById("chk-pareja");
        if (chkP) { chkP.checked=false; togglePareja(); }
        actualizarNombre();
        await cargarDatos(true);
    } catch(e){ toast("❌ Error de conexión","#ef4444"); }
    finally { btn.textContent="Publicar Joya en Catálogo"; btn.disabled=false; }
}

// ═════════════════════════════════════════════
//  ENVÍO
// ═════════════════════════════════════════════
function renderEnvio() {
    const cont=document.getElementById("lista-envio"); cont.innerHTML="";
    if (!cfg.reglasEnvio.length) { cont.innerHTML='<p style="color:#aaa;font-size:13px;">Sin reglas configuradas.</p>'; return; }
    cfg.reglasEnvio.forEach((r,i)=>{
        const mx=r.max>=9999?"en adelante":`$${parseFloat(r.max).toFixed(2)}`;
        const cs=r.costo===0?'<b style="color:var(--verde)">GRATIS</b>':`<b>$${parseFloat(r.costo).toFixed(2)}</b>`;
        cont.innerHTML+=`<div class="er"><span>💰 $${parseFloat(r.min).toFixed(2)} → ${mx} · Envío: ${cs}</span>
            <button class="btn br" style="padding:5px 11px;font-size:12px;" onclick="eliminarEnvio(${i})">Eliminar</button></div>`;
    });
}

function agregarEnvio() {
    const min=parseFloat(document.getElementById("env-min").value);
    const max=parseFloat(document.getElementById("env-max").value)||9999;
    const cos=parseFloat(document.getElementById("env-cos").value);
    if (isNaN(min)||isNaN(cos)) return toast("⚠️ Completa los campos","#f97316");
    cfg.reglasEnvio.push({min,max,costo:cos});
    cfg.reglasEnvio.sort((a,b)=>a.min-b.min);
    saveConfig(); renderEnvio();
    document.getElementById("env-min").value=document.getElementById("env-max").value=document.getElementById("env-cos").value="";
    toast("✅ Regla agregada","#22c55e");
}

function eliminarEnvio(i) {
    cfg.reglasEnvio.splice(i,1); saveConfig(); renderEnvio(); toast("🗑️ Regla eliminada");
}

// ═════════════════════════════════════════════
//  CUPONES
// ═════════════════════════════════════════════
const TIPO_LABEL = {
    porcentaje_total:    "% Tienda",
    porcentaje_categoria:"% Categoría",
    segundo_mitad:       "2do mitad precio",
    monto_minimo:        "Monto mínimo",
    envio_gratis:        "Envío gratis",
    descuento_fijo:      "$ Fijo",
};

function descCuponLabel(cup) {
    switch(cup.tipo) {
        case "porcentaje_total":
        case "porcentaje_categoria": return `-${cup.descuento}%`;
        case "segundo_mitad":        return "2do -50%";
        case "monto_minimo":         return `-$${parseFloat(cup.descuentoFijo||cup.descuento||0).toFixed(2)}`;
        case "envio_gratis":         return "Envío gratis";
        case "descuento_fijo":       return `-$${parseFloat(cup.descuentoFijo||cup.descuento||0).toFixed(2)}`;
        default: return `${cup.descuento||0}%`;
    }
}

function renderCupones() {
    const cont=document.getElementById("lista-cup"); cont.innerHTML="";
    if (!cupones.length) { cont.innerHTML='<p style="color:#aaa;font-size:13px;">Sin cupones registrados.</p>'; return; }
    cupones.forEach((cup,i)=>{
        const tipo  = TIPO_LABEL[cup.tipo] || cup.tipo || "General";
        const desc  = descCuponLabel(cup);
        const cats  = cup.categorias ? ` · ${cup.categorias}` : "";
        const usos  = (cup.limiteUsos > 0 ? ` · ${cup.usosActuales||0}/${cup.limiteUsos} usos` : (cup.usosActuales ? ` · ${cup.usosActuales} usos` : ""))
            + (cup.tipo !== "monto_minimo" && cup.montoMinimo > 0 ? ` · mín. $${parseFloat(cup.montoMinimo).toFixed(2)}` : "")
            + (cup.descuentoMax > 0 ? ` · máx. $${parseFloat(cup.descuentoMax).toFixed(2)}` : "")
            + (cup.tienda === "us" ? " · 🇺🇸 solo USA" : cup.tienda === "sv" ? " · 🇸🇻 solo SV" : "")
            + (cup.vence ? ` · ${cup.vence < new Date().toISOString().slice(0,10) ? "⛔ venció" : "vence"} ${cup.vence.split("-").reverse().join("/")}` : "")
            + (cup.unoPorCliente ? " · 1 por cliente" : "");
        cont.innerHTML+=`<div class="cr">
            <span class="cc">${cup.codigo}</span>
            <span style="font-size:11px;background:#e1f5fe;color:#0277bd;padding:3px 8px;border-radius:20px;font-weight:600;">${tipo}</span>
            <span class="cd">${desc}</span>
            <span class="cf" style="font-size:12px;color:#888;">${cats}${usos}</span>
            <span class="cf"><span class="badge ${cup.activo?"bv2":"br2"}">${cup.activo?"Activo":"Inactivo"}</span></span>
            <button class="btn ${cup.activo?"bn":"bv"}" style="padding:5px 11px;font-size:12px;" onclick="toggleCupon(${i})">${cup.activo?"Desactivar":"Activar"}</button>
            <button class="btn br" style="padding:5px 11px;font-size:12px;" onclick="eliminarCupon(${i})">Eliminar</button>
        </div>`;
    });
}

let _cupCatsMode = "todas"; // "todas" | "seleccion"

function setCatsMode(mode) {
    _cupCatsMode = mode;
    const btnTodas = document.getElementById("btn-cats-todas");
    const btnSel   = document.getElementById("btn-cats-sel");
    const detalle  = document.getElementById("sec-cats-detalle");
    btnTodas.style.background   = mode === "todas" ? "var(--verde)" : "var(--gris)";
    btnTodas.style.color        = mode === "todas" ? "#fff" : "#aaa";
    btnTodas.style.borderColor  = mode === "todas" ? "var(--verde)" : "var(--borde)";
    btnSel.style.background     = mode === "seleccion" ? "var(--azul)" : "var(--gris)";
    btnSel.style.color          = mode === "seleccion" ? "#fff" : "#aaa";
    btnSel.style.borderColor    = mode === "seleccion" ? "var(--azul)" : "var(--borde)";
    detalle.style.display       = mode === "seleccion" ? "flex" : "none";
    actualizarPreviewCupon();
}

function cambiarTipoCupon() {
    const tipo = document.getElementById("cup-tipo").value;
    document.getElementById("sec-porc").style.display      = ["porcentaje_total","porcentaje_categoria"].includes(tipo) ? "block" : "none";
    document.getElementById("sec-fijo").style.display      = tipo === "descuento_fijo" ? "block" : "none";
    document.getElementById("sec-monto-min").style.display = tipo === "monto_minimo" ? "block" : "none";
    // Siempre mostrar selector de categorías excepto envío gratis
    document.getElementById("sec-cats").style.display      = tipo === "envio_gratis" ? "none" : "block";
    // «Monto mínimo» ya pide su propia compra mínima; el tope solo tiene sentido en los descuentos por %
    document.getElementById("sec-cond-min").style.display  = tipo === "monto_minimo" ? "none" : "block";
    document.getElementById("sec-tope").style.display      = ["porcentaje_total","porcentaje_categoria","segundo_mitad"].includes(tipo) ? "block" : "none";
    actualizarPreviewCupon();
}

document.addEventListener("input", e => { if (e.target.closest && e.target.closest("#tab-4") && e.target.id && e.target.id.startsWith("cup-")) actualizarPreviewCupon(); });
document.addEventListener("change", e => { if (e.target.closest && e.target.closest("#tab-4") && e.target.id && e.target.id.startsWith("cup-")) actualizarPreviewCupon(); });
function actualizarPreviewCupon() {
    const tipo = document.getElementById("cup-tipo").value;
    const cod  = document.getElementById("cup-cod").value.trim().toUpperCase() || "CODIGO";
    const prev = document.getElementById("cup-preview");
    let texto  = "";
    switch(tipo) {
        case "porcentaje_total": {
            const d    = document.getElementById("cup-desc").value || "X";
            const donde = _cupCatsMode === "todas" ? "toda la tienda" :
                ([...document.querySelectorAll(".cup-cat:checked")].map(x=>x.value).join(", ") || "ninguna categoría");
            texto = `Cupón <b>${cod}</b>: ${d}% de descuento en ${donde}.`; break; }
        case "porcentaje_categoria": {
            const d    = document.getElementById("cup-desc").value || "X";
            const cats = [...document.querySelectorAll(".cup-cat:checked")].map(x=>x.value).join(", ") || "ninguna";
            texto = `Cupón <b>${cod}</b>: ${d}% de descuento en categorías: ${cats}.`; break; }
        case "segundo_mitad": {
            const cats = [...document.querySelectorAll(".cup-cat:checked")].map(x=>x.value).join(", ") || "todo el carrito";
            texto = `Cupón <b>${cod}</b>: El producto de menor valor queda al 50%.`; break; }
        case "monto_minimo": {
            const min = document.getElementById("cup-min").value || "X";
            const d   = document.getElementById("cup-desc-min").value || "X";
            texto = `Cupón <b>${cod}</b>: $${d} de descuento en compras mayores a $${min}.`; break; }
        case "envio_gratis":
            texto = `Cupón <b>${cod}</b>: Envío gratis sin importar el monto.`; break;
        case "descuento_fijo": {
            const d = document.getElementById("cup-monto-fijo").value || "X";
            texto = `Cupón <b>${cod}</b>: $${d} de descuento fijo en la compra.`; break; }
    }
    // Condiciones en lenguaje normal
    const cond = [];
    const num = id => parseFloat(document.getElementById(id).value) || 0;
    if (tipo !== "monto_minimo" && num("cup-cond-min") > 0) cond.push(`en compras desde $${num("cup-cond-min").toFixed(2)} (sin contar el envío)`);
    if (document.getElementById("sec-tope").style.display !== "none" && num("cup-tope") > 0) cond.push(`máximo $${num("cup-tope").toFixed(2)} de descuento`);
    const tienda = document.getElementById("cup-tienda").value;
    cond.push(tienda === "us" ? "solo en la tienda USA" : tienda === "sv" ? "solo en El Salvador" : "en ambas tiendas");
    const vence = document.getElementById("cup-vence").value;
    if (vence) cond.push(`vence el ${new Date(vence + "T12:00").toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}`);
    if (document.getElementById("cup-uno").checked) cond.push("un solo uso por cliente");
    if (num("cup-limite") > 0) cond.push(`máximo ${num("cup-limite")} usos en total`);
    if (texto && cond.length) texto += `<br>📋 ${cond.join(" · ")}.`;
    prev.innerHTML = `💡 ${texto}`;
    prev.style.display = texto ? "block" : "none";
}

async function crearCupon() {
    const cod   = document.getElementById("cup-cod").value.trim().toUpperCase();
    const tipo  = document.getElementById("cup-tipo").value;
    const act   = document.getElementById("cup-act").value === "true";
    const limite = parseInt(document.getElementById("cup-limite").value) || 0;

    if (!cod) return toast("⚠️ Ingresa un código de cupón", "#f97316");
    if (cupones.find(c => c.codigo === cod)) return toast("⚠️ Ese código ya existe", "#f97316");

    // Categorías: vacío = todas, lista = específicas
    const cats = _cupCatsMode === "todas" ? "" :
        [...document.querySelectorAll(".cup-cat:checked")].map(x => x.value).join(",");
    // Si es selección específica y no eligió nada, advertir
    if (_cupCatsMode === "seleccion" && !cats && tipo !== "envio_gratis")
        return toast("⚠️ Selecciona al menos una categoría", "#f97316");
    // Unificar tipo: si hay cats específicas usar porcentaje_categoria, si no porcentaje_total
    const tipoFinal = (tipo === "porcentaje_total" && cats) ? "porcentaje_categoria" : tipo;

    let descuento = 0, descuentoFijo = 0, montoMinimo = 0;

    switch(tipo) {
        case "porcentaje_total":
        case "porcentaje_categoria":
            descuento = parseFloat(document.getElementById("cup-desc").value);
            if (!descuento) return toast("⚠️ Ingresa el porcentaje", "#f97316");
            break;
        case "segundo_mitad":
            descuento = 50;
            break;
        case "monto_minimo":
            montoMinimo  = parseFloat(document.getElementById("cup-min").value);
            descuentoFijo = parseFloat(document.getElementById("cup-desc-min").value);
            if (!montoMinimo || !descuentoFijo) return toast("⚠️ Completa monto y descuento", "#f97316");
            break;
        case "envio_gratis":
            descuento = 100;
            break;
        case "descuento_fijo":
            descuentoFijo = parseFloat(document.getElementById("cup-monto-fijo").value);
            if (!descuentoFijo) return toast("⚠️ Ingresa el monto de descuento", "#f97316");
            break;
    }

    if (tipo !== "monto_minimo") montoMinimo = parseFloat(document.getElementById("cup-cond-min").value) || 0;
    const descuentoMax = document.getElementById("sec-tope").style.display !== "none" ? (parseFloat(document.getElementById("cup-tope").value) || 0) : 0;
    const tienda = document.getElementById("cup-tienda").value;
    const vence = document.getElementById("cup-vence").value || "";
    const unoPorCliente = document.getElementById("cup-uno").checked;
    if (vence && vence < new Date().toISOString().slice(0, 10)) return toast("⚠️ La fecha de vencimiento ya pasó", "#f97316");

    const nuevo = { codigo:cod, tipo:tipoFinal, descuento, descuentoFijo, montoMinimo,
                    categorias:cats, limiteUsos:limite, usosActuales:0, activo:act,
                    descuentoMax, tienda, vence, unoPorCliente };
    cupones.push(nuevo); renderCupones();

    // Limpiar form
    document.getElementById("cup-cod").value = "";
    document.getElementById("cup-desc").value = "";
    document.getElementById("cup-monto-fijo").value = "";
    document.getElementById("cup-min").value = "";
    document.getElementById("cup-desc-min").value = "";
    document.getElementById("cup-limite").value = "0";
    document.getElementById("cup-cond-min").value = "0";
    document.getElementById("cup-tope").value = "0";
    document.getElementById("cup-tienda").value = "ambas";
    document.getElementById("cup-vence").value = "";
    document.getElementById("cup-uno").checked = false;
    document.querySelectorAll(".cup-cat").forEach(x => x.checked = false);
    document.getElementById("cup-preview").style.display = "none";

    const rC = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ accion:"CREAR_CUPON", _pass:ADMIN_PASS, ...nuevo }) }).then(x => x.json()).catch(() => null);
    if (!rC?.ok) { cupones = cupones.filter(c => c !== nuevo); renderCupones(); return toast("❌ No se pudo guardar el cupón en el servidor", "#ef4444"); }
    toast("✅ Cupón creado", "#22c55e");
}

async function toggleCupon(i) {
    cupones[i].activo=!cupones[i].activo; renderCupones();
    await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:"TOGGLE_CUPON",_pass:ADMIN_PASS,codigo:cupones[i].codigo,activo:cupones[i].activo})});
    toast(cupones[i].activo?"✅ Cupón activado":"🔴 Cupón desactivado");
}

async function eliminarCupon(i) {
    if (!confirm(`¿Eliminar cupón "${cupones[i].codigo}"?`)) return;
    const cod=cupones[i].codigo; cupones.splice(i,1); renderCupones();
    await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:"ELIMINAR_CUPON",_pass:ADMIN_PASS,codigo:cod})});
    toast("🗑️ Cupón eliminado");
}
