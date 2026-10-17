// Hub VEREX — Nuevo lote de productos
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── NUEVO LOTE ───────────────────────────────────────────────────────
let loteFotos = [];
let loteFotosOriginales = [];
let loteFotosFiles = [];
let loteCropCoords = [];
let loteProductos = [];

function cargarFotosLote(input) {
    const files = Array.from(input.files).slice(0, 20);
    loteFotos = []; loteFotosOriginales = []; loteFotosFiles = []; loteCropCoords = [];
    const preview = document.getElementById("lote-preview");
    preview.innerHTML = "";
    let processed = 0;

    files.forEach((file, i) => {
        loteFotosFiles[i] = file;
        procesarFotoJoya(file).then(r => {
            loteFotos[i] = r.preview;
            loteFotosOriginales[i] = r.original;
            loteCropCoords[i] = r.crop;
            const div = document.createElement("div");
            div.style.cssText = "position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;";
            div.innerHTML = `<img src="${r.preview}" style="width:100%;height:100%;object-fit:cover;">
                <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);font-size:10px;color:#fff;padding:2px;text-align:center;">${i+1}</div>`;
            preview.appendChild(div);
            processed++;
            if (processed === files.length) {
                document.getElementById("btn-analizar-lote").style.display = "flex";
            }
        });
    });
}

// Mapea lo que devuelve la IA (texto libre o código) al código de categoría del sistema
function mapCategoriaIA(cat) {
    if (!cat) return "";
    const c = String(cat).toLowerCase().trim();
    if (c === "an" || c.includes("anillo"))                          return "AN";
    if (c === "pu" || c.includes("pulser"))                          return "PU";
    if (c === "co" || (c.includes("collar") && !c.includes("cj")))  return "CO";
    if (c === "ar" || c.includes("aret"))                            return "AR";
    if (c === "cj" || c.includes("conjunto"))                        return "CJ";
    if (c === "dj" || c.includes("dije"))                            return "DJ";
    if (c === "tb" || c.includes("tobill"))                          return "TB";
    if (c === "cd" || c.includes("cadena") && c.includes("dije"))    return "CD";
    if (c === "ca" || c.includes("cadena"))                          return "CA";
    if (c === "rs" || c.includes("rosario"))                         return "RS";
    if (c === "re" || c.includes("reloj"))                           return "RE";
    return "";
}

async function analizarLote() {
    if (!loteFotos.length) return;
    document.getElementById("lote-paso1").style.display = "none";
    document.getElementById("lote-paso2").style.display = "block";
    loteProductos = loteFotos.map((foto, i) => ({ foto, fotoOriginal: loteFotosOriginales[i] || foto, fotoFile: loteFotosFiles[i] || null, fotoCrop: loteCropCoords[i] || null, nombre: "", descripcion: "", precio: "", categoria: "", analizando: true, errorIA: false, idx: i }));
    renderLoteProductos();

    let errores = 0;

    // Analizar una por una con pausa entre llamadas para evitar rate limit OpenAI
    for (let i = 0; i < loteProductos.length; i++) {
        document.getElementById("lote-progreso").textContent = `Analizando ${i+1} de ${loteProductos.length}...`;
        let intentos = 0;
        let exito = false;
        while (intentos < 3 && !exito) {
            try {
                if (intentos > 0) {
                    document.getElementById("lote-progreso").textContent = `Reintentando foto ${i+1}... (espera)`;
                    await new Promise(r => setTimeout(r, 5000 * intentos));
                }
                const res = await fetch(API_URL, {
                    method: "POST",
                    body: JSON.stringify({ accion: "ANALIZAR_IMAGEN", _pass: _sessionPass, imagen: await comprimirParaIA(loteFotos[i]), material: _materialLote })
                });
                const data = await res.json();
                if (data.ok && data.resultado) {
                    const capN = s => s ? s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
                    loteProductos[i].nombre            = capN(data.resultado.nombre || "");
                    loteProductos[i].descripcion       = data.resultado.descripcion       || "";
                    loteProductos[i].descripcionTienda = data.resultado.descripcion_tienda || "";
                    loteProductos[i].categoria         = mapCategoriaIA(data.resultado.categoria);
                    exito = true;
                } else if (data.error && data.error.includes("429")) {
                    intentos++;
                } else {
                    loteProductos[i].errorIA = true;
                    errores++;
                    exito = true;
                }
            } catch(e) {
                loteProductos[i].errorIA = true;
                errores++;
                exito = true;
            }
        }
        if (!exito) { loteProductos[i].errorIA = true; errores++; }
        loteProductos[i].analizando = false;
        renderLoteProductos();
        // Pausa entre fotos para no saturar la API
        if (i < loteProductos.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    const texto = errores > 0
        ? `⚠️ ${loteProductos.length - errores}/${loteProductos.length} analizados — completa los que fallaron manualmente`
        : `✅ ${loteProductos.length} productos listos — revisa y agrega precios`;
    document.getElementById("lote-progreso").textContent = texto;
}

function renderLoteProductos() {
    const lista = document.getElementById("lote-lista");
    const tallasBtns = [5,6,7,8,9,10,11,12,13,14];
    lista.innerHTML = loteProductos.map((p, i) => {
        // Estado del análisis
        let estadoHTML = "";
        if (p.analizando) {
            estadoHTML = '<div style="color:var(--dorado);font-size:12px;padding:8px 0;">⏳ Analizando...</div>';
        } else if (p.errorIA) {
            estadoHTML = '<div style="color:#e67e22;font-size:11px;margin-bottom:6px;">⚠️ IA no pudo analizar — llena manualmente</div>';
        }

        // Opciones del select de categoría
        const cats = [
            ["AN","Anillos"],["PU","Pulseras"],["CO","Collares"],["AR","Aretes"],
            ["CJ","Conjuntos"],["DJ","Dijes"],["TB","Tobilleras"],
            ["CD","Cadenas con Dije"],["CA","Cadenas solas"],["RS","Rosarios"],["RE","Relojes"]
        ];
        const opsCat = cats.map(([v,l]) =>
            '<option value="' + v + '"' + (p.categoria === v ? ' selected' : '') + '>' + l + '</option>'
        ).join('');

        // Botones de talla con cantidad individual por talla
        const mostrarTallas = (p.categoria === 'AN' || p.categoria === 'CJ');
        const esCJ = p.categoria === 'CJ';
        const tqty = p.tallasQty || {};
        const btnsTalla = tallasBtns.map(t => {
            const sel = tqty[t] !== undefined;
            const qty = tqty[t] || 1;
            if (sel) {
                // Talla seleccionada: mostrar contador - qty +
                return '<div style="display:inline-flex;align-items:center;gap:2px;background:var(--dorado);border-radius:6px;padding:2px 4px;">' +
                    '<button type="button" onclick="cambiarCantidadTalla(' + i + ',' + t + ',-1)" ' +
                    'style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">−</button>' +
                    '<span style="font-size:11px;font-weight:700;color:var(--negro);min-width:28px;text-align:center;">T' + t + '<br><span id="qty-talla-' + i + '-' + t + '" style="font-size:10px;">×' + qty + '</span></span>' +
                    '<button type="button" onclick="cambiarCantidadTalla(' + i + ',' + t + ',1)" ' +
                    'style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;">+</button>' +
                    '<button type="button" onclick="toggleTallaLoteMulti(' + i + ',' + t + ')" ' +
                    'style="background:rgba(0,0,0,0.2);border:none;color:var(--negro);border-radius:4px;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;">✕</button>' +
                    '</div>';
            } else {
                // Talla no seleccionada: botón simple para agregar
                return '<button type="button" onclick="toggleTallaLoteMulti(' + i + ',' + t + ')" ' +
                    'style="padding:5px 8px;border:1px solid var(--borde);border-radius:6px;' +
                    'background:var(--gris);color:var(--blanco);font-size:11px;font-weight:600;cursor:pointer;">T' + t + '</button>';
            }
        }).join('');

        // Campos de formulario (solo cuando no está analizando)
        let camposHTML = "";
        if (!p.analizando) {
            camposHTML =
                '<input type="text" value="' + (p.nombre || '') + '" placeholder="Nombre" ' +
                'style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'oninput="loteProductos[' + i + '].nombre=this.value">' +

                '<select style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'onchange="loteProductos[' + i + '].categoria=this.value;toggleTallaLote(' + i + ',this.value)">' +
                '<option value="">-- Categoría --</option>' + opsCat + '</select>' +

                '<input type="text" value="' + (p.codigoManual || '') + '" placeholder="Código manual (opcional — se auto-genera si vacío)" ' +
                'style="margin-bottom:6px;padding:6px;font-size:11px;color:var(--plateado);font-family:sans-serif;" ' +
                'oninput="loteProductos[' + i + '].codigoManual=this.value.toUpperCase();this.value=this.value.toUpperCase()">' +

                '<div id="talla-lote-' + i + '" style="display:' + (mostrarTallas ? 'flex' : 'none') + ';flex-wrap:wrap;gap:6px;margin-bottom:4px;">' +
                '<div style="font-size:11px;color:var(--plateado);width:100%;margin-bottom:4px;">' +
                (esCJ ? 'Tallas de anillo <span style="color:#e67e22;font-size:10px;">(opcional — solo si incluye anillo)</span>' : 'Tallas <span style="color:#e74c3c;font-size:10px;">*obligatorio</span>') +
                ':</div>' +
                btnsTalla +
                '</div>' +
                (mostrarTallas ?
                '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">' +
                '<input type="number" id="talla-esp-lote-' + i + '" placeholder="Talla especial (7.5…)" step="0.5" min="4" max="15" ' +
                'style="flex:1;padding:5px 8px;font-size:11px;background:var(--gris);border:1px solid var(--borde);border-radius:6px;color:var(--blanco);">' +
                '<button type="button" onclick="agregarTallaEspecialLote(' + i + ')" ' +
                'style="padding:5px 10px;background:var(--gris2);border:1px solid var(--borde);border-radius:6px;color:var(--plateado);font-size:11px;font-weight:600;cursor:pointer;">+ Agregar</button>' +
                '</div>'
                : '') +

                '<input type="number" id="lote-precio-' + i + '" value="' + (p.precio || '') + '" placeholder="Precio $" step="0.01" ' +
                'style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'oninput="loteProductos[' + i + '].precio=this.value">' +

                '<input type="text" value="' + (p.caracterEspecial || '') + '" placeholder="Características especiales (ej: hipoalergénico, ajustable…)" ' +
                'style="margin-bottom:6px;padding:6px;font-size:12px;" ' +
                'oninput="loteProductos[' + i + '].caracterEspecial=this.value">' +

                // Cantidad: si hay tallas seleccionadas mostrar total automático, si no campo editable
                (Object.keys(tqty).length > 0
                    ? '<div style="padding:6px 8px;background:var(--gris);border-radius:6px;font-size:12px;color:var(--plateado);">Total: <b style="color:var(--dorado);" id="total-tallas-' + i + '">' +
                      Object.values(tqty).reduce((s, q) => s + q, 0) +
                      ' piezas</b> <span style="font-size:10px;">(suma de tallas)</span></div>'
                    : '<input type="number" value="' + (p.cantidad || 1) + '" placeholder="Cantidad" min="1" ' +
                      'style="margin-bottom:0;padding:6px;font-size:12px;" ' +
                      'oninput="loteProductos[' + i + '].cantidad=this.value">'
                );
        }

        return '<div style="display:flex;gap:10px;padding:10px;background:var(--gris2);border-radius:10px;margin-bottom:8px;align-items:flex-start;">' +
            '<img src="' + (ikFoto(p.foto,200)||'') + '" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;">' +
            '<div style="flex:1;min-width:0;">' + estadoHTML + camposHTML + '</div>' +
            '<button onclick="eliminarDeLote(' + i + ')" style="background:rgba(192,57,43,0.2);border:none;color:#e74c3c;border-radius:6px;padding:4px 8px;cursor:pointer;flex-shrink:0;">🗑️</button>' +
            '</div>';
    }).join('');
}

function aplicarPrecioGlobal() {
    const precio = document.getElementById("lote-precio-global").value;
    if (!precio) { toast("⚠️ Ingresa un precio"); return; }
    loteProductos.forEach((p, i) => {
        p.precio = precio;
        const el = document.getElementById("lote-precio-" + i);
        if (el) el.value = precio;
    });
    toast("✅ Precio aplicado a todos");
}

function eliminarDeLote(i) {
    loteProductos.splice(i, 1);
    loteFotos.splice(i, 1);
    loteProductos.forEach((p, idx) => p.idx = idx);
    renderLoteProductos();
}

function volverLotePaso1() {
    document.getElementById("lote-paso1").style.display = "block";
    document.getElementById("lote-paso2").style.display = "none";
}

async function confirmarLote() {
    const invalidos = loteProductos.filter(p => !p.nombre || !p.precio || !p.categoria);
    if (invalidos.length) { toast("⚠️ Completa nombre, categoría y precio en todos"); return; }

    // Talla obligatoria SOLO para anillos (AN). Conjuntos (CJ) es opcional — no todos llevan anillo.
    const sinTalla = loteProductos.filter(p => p.categoria === "AN" && (!p.tallas || p.tallas.length === 0));
    if (sinTalla.length) { toast("⚠️ Selecciona al menos una talla en los anillos"); return; }

    // ── PASO 1: Generar todo localmente (instantáneo) ─────────────────
    const productosGenerados = [];
    const tareasAPI = []; // llamadas a guardar en background
    const codigosGeneradosEnLote = []; // evitar duplicados dentro del mismo lote

    for (let p of loteProductos) {
        const categoria  = p.categoria;
        const codigoBase = p.codigoManual ? p.codigoManual.trim().toUpperCase() : generarCodigo(categoria, _materialLote, codigosGeneradosEnLote);
        codigosGeneradosEnLote.push(codigoBase);

        // Construir lista de { talla, cantidad } — soporta cantidad individual por talla
        let variantes;
        if (p.tallasQty && Object.keys(p.tallasQty).length > 0) {
            // Tallas con cantidades individuales: { 7:2, 8:1, 9:2 }
            variantes = Object.entries(p.tallasQty)
                .map(([t, qty]) => ({ talla: Number(t), cantidad: Math.max(1, parseInt(qty) || 1) }))
                .sort((a, b) => a.talla - b.talla);
        } else {
            // Sin talla: una sola variante con la cantidad global
            variantes = [{ talla: null, cantidad: parseInt(p.cantidad) || 1 }];
        }

        for (let { talla, cantidad } of variantes) {
            const codigo         = aplicarTalla(codigoBase, talla);
            const nombreConTalla = aplicarTallaNombre(p.nombre, talla);
            const tallaReal      = talla && codigo === codigoBase ? "" : (talla ? String(talla) : "");

            // ── Validar duplicado ─────────────────────────────────────────────
            const existeDup = stockData.find(s => String(s.codigo).toUpperCase() === codigo.toUpperCase());
            if (existeDup) {
                toast(`⚠️ Código ${codigo} ya existe — "${existeDup.nombre}" — omitido`);
                continue; // saltar esta variante
            }

            const prod = {
                id:          codigo + "_" + Date.now(),
                codigo,
                codigoBase,
                talla:       tallaReal,
                nombre:      nombreConTalla,
                nombre_base: p.nombre,
                descripcion: p.descripcion,
                precio:      parseFloat(p.precio),
                precioNum:   parseFloat(p.precio),
                img:         p.foto,   // base64 solo en memoria para preview inmediato
                categoria,
                esNuevo:     true,
                _fotoBase64: p.fotoOriginal || p.foto,
                _fotoFile:   p.fotoFile || null,
                _fotoCrop:   p.fotoCrop || null,
                cantidad
            };

            // Guardar en localStorage SIN base64 (evitar QuotaExceededError)
            const prodParaStorage = {
                id: prod.id, codigo, codigoBase,
                talla: prod.talla, nombre: prod.nombre, nombre_base: p.nombre,
                descripcion: p.descripcion, precio: prod.precio, precioNum: prod.precio,
                img: "",           // vacío hasta que ImageKit devuelva la URL
                categoria, esNuevo: true, cantidad
            };
            try {
                const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
                const idxExistente = extras.findIndex(x => x.codigo === codigo);
                if (idxExistente >= 0) extras[idxExistente] = prodParaStorage; else extras.push(prodParaStorage);
                localStorage.setItem("vx_prod_extras", JSON.stringify(extras));
            } catch(e) { console.warn("localStorage lleno, producto solo en memoria:", codigo); }

            mapaProductos[codigo]  = prod;
            carritoEntrega[codigo] = { item: prod, qty: cantidad };
            productosGenerados.push(prod);

            // Encolar tarea para guardar en Google Sheets en background
            tareasAPI.push({
                accion:            "STOCK_REGISTRAR",
                codigo,
                codigoBase,
                talla:             prod.talla,
                nombre:            nombreConTalla,
                nombre_base:       p.nombre,
                categoria,
                material:          _materialLote || "",
                precio:            parseFloat(p.precio),
                foto:              p.foto,
                cantidad,
                descripcion:       p.descripcion,
                descripcionTienda: p.descripcionTienda || "",
                caracterEspecial:  p.caracterEspecial || ""
            });
        }
    }

    // ── PASO 2: Cerrar modal y mostrar UI inmediatamente ──────────────
    cerrarModal("modal-lote");
    renderGridEntrega(productosDisponibles);
    actualizarCarritoEntrega();
    toast("✅ " + productosGenerados.length + " productos listos — sincronizando con servidor...");

    // ── PASO 3: Background — subir fotos a ImageKit + guardar en Sheets ─
    // Orden correcto: 1° ImageKit (en paralelo) → 2° Sheets con URL real
    (async () => {
        // 3a. Subir TODAS las fotos a ImageKit en paralelo
        toast("☁️ Subiendo fotos...");
        const uploadResults = await Promise.allSettled(
            productosGenerados.map(prod =>
                subirFotoImageKit(prod._fotoFile || prod._fotoBase64, prod.codigo, prod._fotoCrop)
                    .then(url => ({ prod, url: url || null }))
                    .catch(() => ({ prod, url: null }))
            )
        );

        // 3b. Actualizar URLs en local state con la URL real de ImageKit
        const extrasActuales = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
        let cambiosStorage = false;
        uploadResults.forEach(r => {
            if (r.status !== "fulfilled") return;
            const { prod, url } = r.value;
            if (!url) return;
            prod.img = url;
            if (mapaProductos[prod.codigo])          mapaProductos[prod.codigo].img = url;
            if (carritoEntrega[prod.codigo])         carritoEntrega[prod.codigo].item.img = url;
            const idx = extrasActuales.findIndex(x => x.codigo === prod.codigo);
            if (idx >= 0) { extrasActuales[idx].img = url; cambiosStorage = true; }
        });
        // Guardar una sola vez al final (más eficiente que guardar uno por uno)
        if (cambiosStorage) {
            try { localStorage.setItem("vx_prod_extras", JSON.stringify(extrasActuales)); } catch(e) {}
        }

        // 3c. Guardar en Google Sheets con la URL real (no base64)
        // En lotes de 5 para no saturar Apps Script
        const LOTE = 5;
        let guardados = 0;
        for (let i = 0; i < tareasAPI.length; i += LOTE) {
            const grupo = tareasAPI.slice(i, i + LOTE).map(datos => {
                // Reemplazar foto con URL de ImageKit si ya se subió
                const prod = mapaProductos[datos.codigo];
                return { ...datos, foto: (prod && prod.img && !prod.img.startsWith("data:")) ? prod.img : "" };
            });
            const resultados = await Promise.allSettled(grupo.map(d => apiPost(d)));
            guardados += resultados.filter(r => r.status === "fulfilled" && r.value?.ok).length;
        }

        const total = tareasAPI.length;
        toast(guardados === total
            ? "✅ " + guardados + " productos guardados en servidor"
            : "⚠️ " + guardados + "/" + total + " guardados — revisa conexión"
        );
        cargarStock();
    })();
}
