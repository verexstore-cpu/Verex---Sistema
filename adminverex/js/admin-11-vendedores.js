// Admin VEREX — Vendedores / consignación (pestaña 6)
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  TAB 6 — VENDEDORES / CONSIGNACIÓN
// ═════════════════════════════════════════════
let _consigData = null;   // { vendedores, consignacion }
let _vendorActual = null; // vendedor abierto en el modal

async function cargarConsignacion(forzar = false) {
    if (_consigData && !forzar) { renderVendedores(); return; }
    document.getElementById("vend-loading").style.display = "block";
    document.getElementById("vend-lista").innerHTML = "";
    try {
        const res  = await fetch(API_URL, { method:"POST", body: JSON.stringify({ accion:"GET_CONSIGNACION", _pass: ADMIN_PASS }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error");
        _consigData = data;
        renderVendedores();
    } catch(e) {
        document.getElementById("vend-loading").style.display = "none";
        document.getElementById("vend-lista").innerHTML = '<p style="color:#ef4444;font-size:13px;">⚠️ Error al cargar datos de consignación.</p>';
    }
}

function renderVendedores() {
    document.getElementById("vend-loading").style.display = "none";
    const vendedores   = _consigData.vendedores   || [];
    const consignacion = _consigData.consignacion  || [];

    if (!vendedores.length) {
        document.getElementById("vend-lista").innerHTML = '<p style="color:#aaa;font-size:13px;">No hay vendedores registrados.</p>';
        return;
    }

    const html = vendedores.map(v => {
        const items = consignacion.filter(c => String(c.vendedor) === String(v.codigo) && c.estado === "activo");
        const totalEntregado = items.reduce((s,c) => s + (parseInt(c.cantidad)||0), 0);
        const totalVendido   = items.reduce((s,c) => s + (parseInt(c.vendido)||0), 0);
        const totalDisp      = totalEntregado - totalVendido;
        const valorDisp      = items.reduce((s,c) => s + Math.max(0, (parseInt(c.cantidad)||0)-(parseInt(c.vendido)||0)) * parseFloat(c.precio||0), 0);
        const hayVentas      = items.some(c => (parseInt(c.vendido)||0) > 0);

        return `<div style="display:flex;align-items:center;gap:12px;padding:13px;background:var(--gris);border:1px solid var(--borde);border-radius:10px;margin-bottom:9px;flex-wrap:wrap;">
            <div style="width:40px;height:40px;background:#111;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">👤</div>
            <div style="flex:1;min-width:150px;">
                <div style="font-weight:700;font-size:14px;">${v.nombre || v.codigo}</div>
                <div style="font-size:12px;color:#888;margin-top:2px;">📱 ${v.telefono||"—"}</div>
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;text-align:center;">
                <div><div style="font-weight:800;font-size:16px;color:var(--azul);">${totalEntregado}</div><div style="color:#888;">Entregado</div></div>
                <div><div style="font-weight:800;font-size:16px;color:var(--verde);">${totalVendido}</div><div style="color:#888;">Vendido</div></div>
                <div><div style="font-weight:800;font-size:16px;color:var(--naranja);">${totalDisp}</div><div style="color:#888;">Disponible</div></div>
                <div><div style="font-weight:800;font-size:16px;color:#7c3aed;">$${valorDisp.toFixed(2)}</div><div style="color:#888;">Valor</div></div>
            </div>
            <button class="btn ba" onclick="abrirVentasVendedor('${v.codigo}')" ${!hayVentas?'style="opacity:.5"':''}>
                💰 Ver ventas
            </button>
        </div>`;
    }).join("");

    document.getElementById("vend-lista").innerHTML = html +
        `<button class="btn bg" onclick="cargarConsignacion(true)" style="margin-top:6px;">🔄 Actualizar</button>`;
}

function abrirVentasVendedor(codigoVend) {
    const vendedor     = (_consigData.vendedores||[]).find(v => String(v.codigo) === String(codigoVend));
    const consignacion = _consigData.consignacion || [];
    const items        = consignacion.filter(c => String(c.vendedor) === String(codigoVend) && c.estado === "activo");

    _vendorActual = { codigo: codigoVend, nombre: vendedor?.nombre || codigoVend, items };

    document.getElementById("mv-titulo").textContent = "💰 Ventas — " + (vendedor?.nombre || codigoVend);
    document.getElementById("mv-buscar").value = "";

    const totalVendido  = items.reduce((s,c) => s + (parseInt(c.vendido)||0), 0);
    const totalIngresos = items.reduce((s,c) => s + (parseInt(c.vendido)||0) * parseFloat(c.precio||0), 0);
    const totalDisp     = items.reduce((s,c) => s + Math.max(0,(parseInt(c.cantidad)||0)-(parseInt(c.vendido)||0)), 0);

    document.getElementById("mv-stats").innerHTML = `
        <div class="stat" style="min-width:100px;"><div class="num" style="font-size:20px;">${totalVendido}</div><div class="lbl">Unidades vendidas</div></div>
        <div class="stat" style="min-width:100px;"><div class="num" style="font-size:20px;color:#22c55e;">$${totalIngresos.toFixed(2)}</div><div class="lbl">Ingresos totales</div></div>
        <div class="stat" style="min-width:100px;"><div class="num" style="font-size:20px;color:#f97316;">${totalDisp}</div><div class="lbl">Aún disponibles</div></div>`;

    renderFilasVentas(items);
    document.getElementById("modal-ventas-vend").classList.add("open");
}

function renderFilasVentas(items) {
    const vendidos = items.filter(c => (parseInt(c.vendido)||0) > 0);
    document.getElementById("mv-vacio").style.display = vendidos.length ? "none" : "block";
    document.getElementById("mv-tbody").innerHTML = vendidos.map(c => {
        const cantidad = parseInt(c.cantidad)||0;
        const vendido  = parseInt(c.vendido)||0;
        const disp     = Math.max(0, cantidad - vendido);
        const foto     = c.foto ? `<img src="${ikSharp(c.foto)}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">` : `<div style="width:36px;height:36px;background:#eee;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;">💍</div>`;
        return `<tr>
            <td>${foto}</td>
            <td style="font-weight:700;font-size:12px;color:var(--azul);">${c.codigo||""}</td>
            <td>${c.nombre||""}</td>
            <td>$${parseFloat(c.precio||0).toFixed(2)}</td>
            <td style="text-align:center;">${cantidad}</td>
            <td style="text-align:center;font-weight:700;color:var(--verde);">${vendido}</td>
            <td style="text-align:center;color:${disp>0?"var(--naranja)":"#aaa"};">${disp}</td>
        </tr>`;
    }).join("");
}

function filtrarVentasModal() {
    if (!_vendorActual) return;
    const busq = document.getElementById("mv-buscar").value.toLowerCase();
    const filtrados = _vendorActual.items.filter(c =>
        (c.nombre||"").toLowerCase().includes(busq) || (c.codigo||"").toLowerCase().includes(busq)
    );
    renderFilasVentas(filtrados);
}

function cerrarModalVentas() {
    document.getElementById("modal-ventas-vend").classList.remove("open");
}

// ── Canvas helper ──
function _rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
    ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
    ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}

async function generarImagenCatalogo() {
    const codsSel = [...document.querySelectorAll(".cat-chk:checked")].map(c => c.dataset.cod);
    if (!codsSel.length) return toast("⚠️ Selecciona al menos un producto","#f97316");

    const lista  = _catFiltrada.filter(p => codsSel.includes(p.codigo));
    const nombre = document.getElementById("cat-nombre").value.trim();
    const talla  = document.getElementById("cat-talla").value;
    const dias   = parseInt(document.getElementById("cat-validez").value)||3;

    const btn = document.getElementById("btn-gen-img");
    btn.textContent = "⏳..."; btn.disabled = true;

    try {
        const CW=800, COLS=2, GAP=14, MG=14;
        const CW2 = (CW - MG*2 - GAP) / 2;
        const IH=210, TH=96, CH2=IH+TH;
        const HDR=90, SUB=38, FOOT=34;
        const rows = Math.ceil(lista.length/COLS);
        const TOTAL_H = HDR+SUB+GAP + rows*(CH2+GAP) + FOOT;

        const canvas = document.createElement("canvas");
        canvas.width=CW; canvas.height=TOTAL_H;
        const ctx = canvas.getContext("2d");

        // Header
        ctx.fillStyle="#111"; ctx.fillRect(0,0,CW,HDR);
        ctx.textAlign="center";
        ctx.fillStyle="#00BFFF"; ctx.font="bold 40px 'Segoe UI',Arial";
        ctx.fillText("VEREX",CW/2,54);
        ctx.fillStyle="#999"; ctx.font="15px 'Segoe UI',Arial";
        ctx.fillText("La expresión de tu mejor versión",CW/2,78);

        // Subtitle bar
        ctx.fillStyle="#fff"; ctx.fillRect(0,HDR,CW,SUB);
        ctx.fillStyle="#555"; ctx.font="italic 13px 'Segoe UI',Arial";
        let sub=nombre?`Catálogo para: ${nombre}`:"Catálogo de productos";
        if(talla) sub+=`  ·  Talla ${_tallasDisplay(talla)}`;
        ctx.fillText(sub,CW/2,HDR+15);
        ctx.fillStyle="#f97316"; ctx.font="bold 12px 'Segoe UI',Arial";
        const expStr=new Date(Date.now()+dias*864e5).toLocaleDateString("es-CO");
        ctx.fillText(`⏰ Válido hasta: ${expStr}`,CW/2,HDR+30);

        // BG
        ctx.fillStyle="#f0f2f5"; ctx.fillRect(0,HDR+SUB,CW,TOTAL_H-HDR-SUB-FOOT);

        // Cards
        for(let i=0;i<lista.length;i++){
            const p=lista[i];
            const col=i%COLS, row=Math.floor(i/COLS);
            const x=MG+col*(CW2+GAP), y=HDR+SUB+GAP+row*(CH2+GAP);

            ctx.fillStyle="rgba(0,0,0,0.06)"; _rr(ctx,x+2,y+3,CW2,CH2,10); ctx.fill();
            ctx.fillStyle="#fff"; _rr(ctx,x,y,CW2,CH2,10); ctx.fill();

            const b64=await imgToBase64Cat(p.foto||p.img||"");
            if(b64){
                const img=new Image();
                await new Promise(r=>{img.onload=r;img.onerror=r;img.src=b64;});
                ctx.save(); _rr(ctx,x,y,CW2,IH,10); ctx.clip();
                const mw=CW2-8,mh=IH-8,ratio=img.width/img.height;
                let dw,dh;
                if(ratio>mw/mh){dw=mw;dh=mw/ratio;}else{dh=mh;dw=mh*ratio;}
                ctx.drawImage(img,x+4+(mw-dw)/2,y+4+(mh-dh)/2,dw,dh);
                ctx.restore();
            } else {
                ctx.fillStyle="#f0f0f0"; _rr(ctx,x,y,CW2,IH,10); ctx.fill();
                ctx.fillStyle="#ccc"; ctx.font="28px sans-serif"; ctx.textAlign="center";
                ctx.fillText("💍",x+CW2/2,y+IH/2+10);
            }

            ctx.fillStyle="#1a1a1a"; ctx.font="bold 14px 'Segoe UI',Arial"; ctx.textAlign="center";
            const nm=(p.nombre||"—");
            const nm2=nm.length>28?nm.substring(0,25)+"…":nm;
            ctx.fillText(nm2,x+CW2/2,y+IH+22);

            const matIMG = p.material || detectarMaterial(p.nombre) || "";
            if (matIMG) {
                ctx.fillStyle="#7c3aed"; ctx.font="bold 11px 'Segoe UI',Arial";
                ctx.fillText(matIMG,x+CW2/2,y+IH+40);
            }

            ctx.fillStyle="#00BFFF"; ctx.font="bold 17px 'Segoe UI',Arial";
            ctx.fillText(`$${parseFloat(p.precio||0).toFixed(2)}`,x+CW2/2,y+IH+62);

            const notaIMG = (document.querySelector(`.cat-nota[data-cod="${p.codigo}"]`)?.value||"").trim();
            if (notaIMG) {
                ctx.fillStyle="#888"; ctx.font="italic 11px 'Segoe UI',Arial";
                const notaTxt = notaIMG.length>40?notaIMG.substring(0,37)+"…":notaIMG;
                ctx.fillText(notaTxt,x+CW2/2,y+IH+82);
            }
        }

        // Footer
        ctx.fillStyle="#fff"; ctx.fillRect(0,TOTAL_H-FOOT,CW,FOOT);
        ctx.fillStyle="#aaa"; ctx.font="12px 'Segoe UI',Arial"; ctx.textAlign="center";
        ctx.fillText("VEREX · La expresión de tu mejor versión",CW/2,TOTAL_H-10);

        canvas.toBlob(blob=>{
            const a=document.createElement("a");
            a.href=URL.createObjectURL(blob);
            a.download=nombre?`catalogo-${nombre.toLowerCase().replace(/\s+/g,"-")}.jpg`:"catalogo-verex.jpg";
            a.click();
            toast("✅ Imagen generada","#22c55e");
        },"image/jpeg",0.92);

    } catch(e){ console.error(e); toast("❌ Error al generar imagen","#ef4444"); }
    finally { btn.textContent="🖼️ Imagen"; btn.disabled=false; }
}

function aplicarPromptIA() {
    const promptRaw = (document.getElementById("cat-ia-prompt")?.value || "").trim();
    if (!promptRaw) return;
    const prompt = promptRaw.toLowerCase()
        .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
        .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u').replace(/ñ/g,'n');

    // ── Categorías + exclusiones ─────────────────────────────────────────
    const catKws = {
        AN: /anillo|argolla|alianza|matrimonio|solitario|novio|pareja/,
        AR: /arete|aretes|pendiente|zarcillo/,
        CD: /cadena|collar|gargantilla/,
        PL: /pulsera|brazalete/,
        CN: /conjunto|set/,
        RL: /reloj/,
        DJ: /dije|charm/,
    };
    const exclKws = {
        AN: /sin anillo|no anillo|sin argolla|no argolla/,
        AR: /sin arete|no arete|sin zarcillo|sin pendiente/,
        CD: /sin cadena|no cadena|sin collar/,
        PL: /sin pulsera|no pulsera|sin brazalete/,
        CN: /sin conjunto|no conjunto/,
    };
    const catsDetect  = Object.entries(catKws).filter(([,re]) => re.test(prompt)).map(([k]) => k);
    const catsExcluir = Object.entries(exclKws).filter(([,re]) => re.test(prompt)).map(([k]) => k);

    // ── Tallas: rango "del 8 al 10", lista "talla 8, 9 y 10", o una sola ─
    let tallas = [];
    const mRango = prompt.match(/del?\s*(\d+(?:[.,]\d+)?)\s*al?\s*(\d+(?:[.,]\d+)?)/);
    if (mRango) {
        const desde = parseFloat(mRango[1].replace(",",".")), hasta = parseFloat(mRango[2].replace(",","."));
        for (let t = desde; t <= hasta + 0.01; t += 0.5)
            tallas.push(String(t % 1 < 0.01 ? Math.round(t) : t.toFixed(1)));
    } else {
        const afterTalla = prompt.match(/tallas?\s*([\d.,y \-y]+)/);
        if (afterTalla) tallas = [...afterTalla[1].matchAll(/\d+(?:[.,]\d+)?/g)].map(m => m[0].replace(",","."));
        if (!tallas.length) {
            const mT = prompt.match(/\bt\s*(\d+(?:[.,]\d+)?)\b/);
            if (mT) tallas = [mT[1].replace(",",".")];
        }
    }
    const tallaStr = tallas.join(",");

    // ── Género ───────────────────────────────────────────────────────────
    let pfx = "";
    if (/\bdama\b|\bmujer\b/.test(prompt))            pfx = "D";
    else if (/\bcaballero\b|\bhombre\b/.test(prompt)) pfx = "C";
    else if (/\bunico\b|\bunisex\b/.test(prompt))     pfx = "U";

    // ── Tipo anillo ──────────────────────────────────────────────────────
    let tipoAN = "sencillo";
    if (/argolla|matrimonio|pareja|novios|alianza/.test(prompt)) tipoAN = "pareja";

    // ── Material ─────────────────────────────────────────────────────────
    let materialFiltro = "";
    if (/laminado|oro laminado|chapado/.test(prompt))        materialFiltro = "laminado";
    else if (/acero|316/.test(prompt))                       materialFiltro = "acero";
    else if (/plata\s*(?:925|fina)?|silver/.test(prompt))   materialFiltro = "plata";
    else if (/\boro\b(?!.*laminado)/.test(prompt))           materialFiltro = "oro";

    // ── Precio ───────────────────────────────────────────────────────────
    let precioMax = 0, precioMin = 0;
    const mPMax = prompt.match(/(?:menos de|hasta|maximo|no mas de)\s*\$?\s*(\d+)/);
    const mPMin = prompt.match(/(?:mas de|desde|minimo)\s*\$?\s*(\d+)/);
    if (mPMax) precioMax = parseFloat(mPMax[1]);
    if (mPMin) precioMin = parseFloat(mPMin[1]);
    if (!precioMax && /economico|barato|accesible/.test(prompt)) precioMax = 20;
    if (!precioMin && /premium|fino|lujoso|exclusivo/.test(prompt)) precioMin = 25;

    // ── Cantidad desde prompt ─────────────────────────────────────────────
    const mCant = prompt.match(/\b(\d+)\s*(?:productos?|piezas?|referencias?)\b/) ||
                  prompt.match(/\bunos?\s*(\d+)\b/) ||
                  prompt.match(/\bseleccion\s*(?:de)?\s*(\d+)\b/);
    if (mCant) {
        const sizeEl = document.getElementById("cat-var-size");
        if (sizeEl) sizeEl.value = mCant[1];
    }

    // ── Nombre del cliente ────────────────────────────────────────────────
    const mNom = promptRaw.match(/para\s+([A-ZÁÉÍÓÚ][a-záéíóúüñ]+)/);
    if (mNom) document.getElementById("cat-nombre").value = mNom[1];

    // ── Aplicar categorías al UI ─────────────────────────────────────────
    document.querySelectorAll(".cat-cat-chk").forEach(chk => {
        const incluir = catsDetect.includes(chk.value) && !catsExcluir.includes(chk.value);
        chk.checked = incluir;
    });

    const hasAN = catsDetect.length === 0 || catsDetect.includes("AN");
    document.getElementById("cat-sec-talla").style.display = hasAN ? "block" : "none";
    document.getElementById("cat-talla").value = tallaStr;
    sincronizarChipsCatTalla();
    document.getElementById("cat-tipo-an").value = tipoAN;
    document.getElementById("cat-genero").value  = "";
    const pfEl = document.getElementById("cat-prefijo-txt");
    if (pfEl) pfEl.value = pfx;

    // ── Ocasión (15 años, compromiso…) ───────────────────────────────────
    // Solo se aplica si ya hay productos etiquetados con esa ocasión — si no,
    // el filtro dejaría el catálogo vacío (ej. "anillos caballero talla 10"
    // antes de haber etiquetado nada).
    const ocasionesDetect = ocasionesLista().filter(o => {
        const re = OCASIONES_PALABRAS[o.id];
        const nom = _normTxt(o.nombre).trim();
        return (re && re.test(prompt)) || (nom.length > 2 && prompt.includes(nom));
    }).map(o => o.id);
    const ocasionesAplicadas = ocasionesDetect.filter(_ocasionTieneProductos);
    const ocasionesSinEtiquetar = ocasionesDetect.filter(id => !ocasionesAplicadas.includes(id));
    poblarOcasionesPills(ocasionesAplicadas);

    filtrarParaCatalogo();

    // ── Post-filtro: stock, material y precio ────────────────────────────
    let sinStock = 0, sinMaterial = 0, sinPrecio = 0;
    document.querySelectorAll(".cat-chk").forEach(chk => {
        if (!chk.checked) return;
        const cod  = chk.dataset.cod;
        const prod = _catFiltrada.find(p => (p._codigos?.[0] || p.codigo) === cod);
        if (!prod) return;

        if (tallaStr && !tieneStock(prod, tallas[0])) { chk.checked = false; sinStock++; return; }

        if (materialFiltro) {
            const mat = (prod.material || detectarMaterial(prod.nombre) || "").toLowerCase();
            const nom = (prod.nombre || "").toLowerCase();
            const ok = { laminado: /laminado|chapado/.test(mat+nom), acero: /acero/.test(mat+nom),
                         plata: /plata/.test(mat+nom), oro: /\boro\b(?!\s*laminado)/.test(mat+nom) }[materialFiltro] || false;
            if (!ok) { chk.checked = false; sinMaterial++; return; }
        }

        const precio = parseFloat(prod.precio || 0);
        if (precioMax > 0 && precio > precioMax) { chk.checked = false; sinPrecio++; return; }
        if (precioMin > 0 && precio < precioMin) { chk.checked = false; sinPrecio++; return; }
    });

    // ── Recortar al límite ────────────────────────────────────────────────
    const limite = parseInt(document.getElementById("cat-var-size")?.value) || 0;
    if (limite > 0) {
        const marcados = [...document.querySelectorAll(".cat-chk:checked")]
            .map(chk => ({ chk, prod: _catFiltrada.find(p => (p._codigos?.[0]||p.codigo) === chk.dataset.cod) }))
            .sort((a,b) => _stockTotalProd(b.prod) - _stockTotalProd(a.prod));
        marcados.slice(limite).forEach(({chk}) => { chk.checked = false; });
    }

    // ── Resumen ───────────────────────────────────────────────────────────
    const activos = document.querySelectorAll(".cat-chk:checked").length;
    const omitidos = sinStock + sinMaterial + sinPrecio;
    const resPartes = [];
    if (catsDetect.length)   resPartes.push(catsDetect.map(k=>CAT_MAP[k].replace(/\p{Emoji}/gu,"").trim()).join(", "));
    if (tallas.length)       resPartes.push("Talla " + tallas.join(", "));
    if (pfx)                 resPartes.push({D:"Dama",C:"Caballero",U:"Único"}[pfx]||pfx);
    if (materialFiltro)      resPartes.push(materialFiltro.charAt(0).toUpperCase()+materialFiltro.slice(1));
    if (precioMax)           resPartes.push(`máx $${precioMax}`);
    if (precioMin)           resPartes.push(`mín $${precioMin}`);
    if (catsExcluir.length)  resPartes.push("excluye " + catsExcluir.map(k=>CAT_MAP[k].replace(/\p{Emoji}/gu,"").trim()).join(", "));
    const _nomOc = id => ocasionesLista(true).find(o => o.id === id)?.nombre || id;
    if (ocasionesAplicadas.length)    resPartes.push("Ocasión: " + ocasionesAplicadas.map(_nomOc).join(" / "));
    if (ocasionesSinEtiquetar.length) resPartes.push(`⚠️ aún no hay piezas etiquetadas como ${ocasionesSinEtiquetar.map(_nomOc).join(" / ")}`);
    document.getElementById("cat-ia-resultado").textContent =
        `✅ ${activos} producto(s) listo(s)${omitidos ? ` · ${omitidos} omitido(s)` : ""}`
        + (resPartes.length ? ` — ${resPartes.join(" · ")}` : "");
}

let _bannerColor = "#ef4444";
function selBannerColor(btn, color) {
    _bannerColor = color;
    document.querySelectorAll("#banner-colors button").forEach(b => b.style.border = "3px solid transparent");
    btn.style.border = "3px solid #111";
    const prev = document.getElementById("banner-preview");
    const txt = document.getElementById("cat-banner-txt").value.trim();
    if(txt){ prev.style.display="block"; prev.style.background=color; prev.textContent=txt; }
}
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("cat-banner-txt")?.addEventListener("input", () => {
        const txt = document.getElementById("cat-banner-txt").value.trim();
        const prev = document.getElementById("banner-preview");
        if(txt){ prev.style.display="block"; prev.style.background=_bannerColor; prev.textContent=txt; }
        else { prev.style.display="none"; }
    });
});

function onCambioPromoTipo() {
    const tipo = document.getElementById("cat-promo-tipo")?.value || "";
    const montoFijoWrap = document.getElementById("cat-promo-montofijo-wrap");
    const escalonadoWrap = document.getElementById("cat-promo-escalonado-wrap");
    if (montoFijoWrap) montoFijoWrap.style.display = (tipo === "montoFijo") ? "block" : "none";
    if (escalonadoWrap) escalonadoWrap.style.display = (tipo === "escalonado") ? "block" : "none";
}

// Lee los campos de la promo de carrito y arma el objeto a guardar —
// devuelve null si no hay ninguna promo activa (select en "Ninguna").
function _leerPromoCarritoUI() {
    const tipo = document.getElementById("cat-promo-tipo")?.value || "";
    if (!tipo) return null;
    if (tipo === "montoFijo") {
        const monto = parseFloat(document.getElementById("cat-promo-montofijo")?.value) || 0;
        if (monto <= 0) return null;
        const minimoCompra = parseFloat(document.getElementById("cat-promo-montofijo-minimo")?.value) || 0;
        return { tipo, montoFijo: monto, ...(minimoCompra > 0 && { minimoCompra }) };
    }
    if (tipo === "escalonado") {
        const escalones = [1,2,3].map(n => ({
            minCant: parseInt(document.getElementById(`cat-esc-cant-${n}`)?.value) || 0,
            pct: parseInt(document.getElementById(`cat-esc-pct-${n}`)?.value) || 0
        })).filter(e => e.minCant >= 2 && e.pct > 0 && e.pct <= 90);
        if (!escalones.length) return null;
        return { tipo, escalones };
    }
    return { tipo }; // 2x50 / 3x2 no necesitan datos extra
}
