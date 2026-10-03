

// Llena el filtro de tipo de producto (categoría) con los valores distintos
// presentes en el stock actual — igual que el de material.
function poblarFiltroCategoria() {
    const sel = document.getElementById("fil-stock-categoria");
    if (!sel) return;
    const actual = sel.value;
    const categorias = [...new Set(stockData.map(i => (i.categoria||"").trim().toUpperCase()).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todo tipo</option>' +
        categorias.map(c => `<option value="${c}">${CATEGORIA_LABELS_STOCK[c] || c}</option>`).join("");
    if (categorias.includes(actual)) sel.value = actual;
}

function normalizar(estado) {
    if (!estado) return "bodega";
    const e = estado.toLowerCase().replace(/\s/g, "");
    if (e.includes("bodega")) return "bodega";
    if (e.includes("tienda")) return "tienda";
    if (e.includes("consign")) return "consignacion";
    if (e.includes("reserv")) return "reservado";
    if (e.includes("vendid")) return "vendido";
    return "bodega";
}

function limpiarSeleccion() {
    stockSeleccionados = [];
    document.getElementById("stock-acciones").style.display = "none";
    renderStock(stockData);
}

// Descarga en un solo ZIP las fotos originales (sin transformar) de los
// productos seleccionados en Stock — para procesarlas en una app externa
// de nitidez/mejora y luego resubirlas por "Editar producto".
async function descargarFotosSeleccionadas() {
    if (!stockSeleccionados.length) return;
    const items = stockSeleccionados
        .map(cod => stockData.find(p => String(p.codigo) === String(cod)))
        .filter(Boolean);
    const conFoto = items.filter(i => i.foto || i.img);
    if (!conFoto.length) { toast("⚠️ Ninguno de los seleccionados tiene foto"); return; }

    const btn = document.getElementById("btn-descargar-fotos-stock");
    const textoOriginal = btn.textContent;
    btn.disabled = true;

    const zip = new JSZip();
    let ok = 0;
    const fallidas = [];
    for (let i = 0; i < conFoto.length; i++) {
        const item = conFoto[i];
        btn.textContent = `📥 ${i + 1}/${conFoto.length}...`;
        const url = item.foto || item.img;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(String(resp.status));
            const blob = await resp.blob();
            const ext = (url.split("?")[0].split(".").pop() || "jpg").slice(0, 4);
            zip.file(`${item.codigo || ("item" + i)}.${ext}`, blob);
            ok++;
        } catch (e) {
            fallidas.push(item.codigo || "?");
        }
    }

    if (ok === 0) {
        toast("⚠️ No se pudo descargar ninguna foto (revisá conexión)");
        btn.disabled = false;
        btn.textContent = textoOriginal;
        return;
    }

    btn.textContent = "🗜️ Comprimiendo...";
    const contenido = await zip.generateAsync({ type: "blob" });
    const nombreZip = `fotos-stock-${new Date().toISOString().slice(0, 10)}.zip`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(contenido);
    a.download = nombreZip;
    document.body.appendChild(a);
    a.click();
    a.remove();

    toast(fallidas.length
        ? `✅ ${ok} fotos descargadas · ⚠️ ${fallidas.length} fallaron (${fallidas.slice(0, 5).join(", ")}${fallidas.length > 5 ? "…" : ""})`
        : `✅ ${ok} fotos descargadas en ${nombreZip}`);

    btn.disabled = false;
    btn.textContent = textoOriginal;
}

// ── EDITAR PRODUCTO DESDE STOCK ──────────────────────────────────────
function abrirEditarStockItem(codigo) {
    const item = stockData.find(p => p.codigo === codigo);
    if (!item) return;
    // Reutilizar modal existente de edición de producto
    productoEditando = { key: item.codigo, p: { ...item, img: item.foto || item.img || "" } };
    document.getElementById("modal-prod-titulo").textContent = item.codigo || "Producto";
    const foto = document.getElementById("modal-prod-foto");
    if (item.foto || item.img) { foto.src = ikFoto(item.fotoMejorada || item.foto || item.img, 900); foto.style.display = "block"; }
    else { foto.style.display = "none"; }
    document.getElementById("vp-codigo").textContent  = item.codigo  || "";
    document.getElementById("vp-nombre").textContent  = item.nombre  || "";
    document.getElementById("vp-desc").textContent    = item.descripcion || item.descripcionTienda || "";
    document.getElementById("vp-precio").textContent  = "$" + parseFloat(item.precio || 0).toFixed(2);
    document.getElementById("modal-prod-vista").style.display   = "block";
    document.getElementById("modal-prod-edicion").style.display = "none";
    abrirModal("modal-ver-producto");
}

// ── CORREGIR CANTIDAD EXACTA (bodega/tienda/consignación) ────────────
// Auditoría de SOLO LECTURA — no cambia nada, solo compara stock_consignacion
// (contador agregado, se ajusta manualmente en +20 lugares del código) contra
// la fuente real de verdad (consignación activa por vendedor) y avisa el
// drift, igual al que causó el caso Jaime/PUP035 — para detectarlo antes de
// que alguien note algo raro, no solo después.
async function ejecutarAuditoriaStock() {
    const panel = document.getElementById("auditoria-stock-panel");
    panel.style.display = "block";
    panel.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Auditando... (no se modifica nada)</p>';
    let res;
    try {
        res = await apiPost({ accion: "AUDITORIA_STOCK" });
    } catch(e) {
        panel.innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ Error al auditar: ' + e.message + '</p>';
        return;
    }
    if (!res || res.ok === false) {
        panel.innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ ' + (res?.error||"No se pudo auditar") + '</p>';
        return;
    }
    const { discrepanciasConsignacion, negativos, consHuerfanas, cerradosSinContar, resumen, generadoEn } = res;
    const sinProblemas = !discrepanciasConsignacion.length && !negativos.length && !consHuerfanas.length && !(cerradosSinContar||[]).length;

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;color:var(--dorado);font-size:15px;">🔍 Auditoría de Stock</h3>
        <span style="font-size:11px;color:var(--plateado);">${new Date(generadoEn).toLocaleString('es-SV')} · ${resumen.productosRevisados} productos revisados</span>
    </div>`;

    if (sinProblemas) {
        html += '<p style="color:#2ecc71;font-size:13px;font-weight:700;">✅ Todo cuadra — sin discrepancias, sin negativos, sin huérfanas.</p>';
    } else {
        if (discrepanciasConsignacion.length) {
            html += `<div style="margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#f0b96a;margin-bottom:6px;">⚖️ Contador de consignación desincronizado (${discrepanciasConsignacion.length})</div>
                ${discrepanciasConsignacion.map(d => `
                    <div style="background:#1f1a12;border:1px solid #5a4520;border-radius:8px;padding:8px 10px;margin-bottom:6px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <div>
                                <strong style="font-size:12.5px;">${sanitizar(d.codigo)}</strong> — ${sanitizar(d.nombre)}
                                <div style="font-size:11px;color:var(--plateado);margin-top:2px;">
                                    Registrado: <strong>${d.stock_consignacion_registrado}</strong> · Real (consignación activa): <strong>${d.consignacion_real}</strong>
                                    · Diferencia: <strong style="color:${d.diferencia>0?'#e74c3c':'#3b82f6'};">${d.diferencia>0?'+':''}${d.diferencia}</strong>
                                </div>
                                ${d.detalleVendedores.length ? `<div style="font-size:10.5px;color:#888;margin-top:2px;display:flex;flex-direction:column;gap:3px;">
                                    ${d.detalleVendedores.map(v => `<span>Con: ${sanitizar(v.vendedorNombre)} (${v.cantidad})${!v.vendedorExiste ? ` — <span style="color:#a78bfa;">vendedor ya no existe</span> <button onclick="event.stopPropagation();eliminarConsignacionHuerfana('${sanitizar(v.id)}','${sanitizar(d.codigo)}')" style="padding:2px 8px;font-size:10px;background:#3a2a5a;color:#c4b5fd;border:none;border-radius:5px;cursor:pointer;font-weight:700;">🗑️ Eliminar registro</button>` : ''}</span>`).join('')}
                                </div>` : ''}
                            </div>
                            <button onclick="corregirCantidadExactaStock('${sanitizar(d.codigo)}')" style="padding:5px 10px;font-size:11px;background:#e8b07a;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">⚖️ Corregir</button>
                        </div>
                    </div>`).join('')}
            </div>`;
        }
        if (negativos.length) {
            html += `<div style="margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#e74c3c;margin-bottom:6px;">🚫 Cantidades negativas (${negativos.length}) — no deberían existir</div>
                ${negativos.map(n => `
                    <div style="background:#1f1212;border:1px solid #5a2020;border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong style="font-size:12.5px;">${sanitizar(n.codigo)}</strong> — ${sanitizar(n.nombre)}
                            <div style="font-size:11px;color:var(--plateado);">Bodega: ${n.stock_bodega} · Tienda: ${n.stock_tienda} · Consignación: ${n.stock_consignacion} · Reservado: ${n.stock_reservado}</div>
                        </div>
                        <button onclick="corregirCantidadExactaStock('${sanitizar(n.codigo)}')" style="padding:5px 10px;font-size:11px;background:#e8b07a;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">⚖️ Corregir</button>
                    </div>`).join('')}
            </div>`;
        }
        if (consHuerfanas.length) {
            html += `<div>
                <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:6px;">👻 Consignación activa con código que ya no existe en Stock (${consHuerfanas.length})</div>
                ${consHuerfanas.map(h => `
                    <div style="background:#181225;border:1px solid #3a2a5a;border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong style="font-size:12.5px;">${sanitizar(h.codigo)}</strong> — vendedor: ${sanitizar(h.vendedorNombre)} · cantidad: ${h.cantidad} · vendido: ${h.vendido||0}</div>
                        <button onclick="eliminarConsignacionHuerfana('${sanitizar(h.id)}','${sanitizar(h.codigo)}')" style="padding:5px 10px;font-size:11px;background:#3a2a5a;color:#c4b5fd;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">🗑️ Eliminar registro</button>
                    </div>`).join('')}
                <div style="font-size:11px;color:var(--plateado);margin-top:4px;">Revisa manualmente estos casos en el perfil del vendedor — el producto pudo haberse eliminado de Stock por error.</div>
            </div>`;
        }
        if ((cerradosSinContar||[]).length) {
            html += `<div style="margin-top:14px;">
                <div style="font-size:13px;font-weight:700;color:#52d68a;margin-bottom:6px;">💰 Cerradas con "Ya vendida" pero la venta nunca se contó (${cerradosSinContar.length})</div>
                <div style="font-size:11px;color:var(--plateado);margin-bottom:6px;">Se marcaron como ya liquidadas (sin tocar comisión ni stock) en vez de registrarse como venta nueva — no aparecen en el inventario del vendedor porque ya están cerradas.</div>
                ${cerradosSinContar.map(c => `
                    <div style="background:#0f1f16;border:1px solid #205a3a;border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong style="font-size:12.5px;">${sanitizar(c.codigo)}</strong> — ${sanitizar(c.nombre)}
                            <div style="font-size:11px;color:var(--plateado);">Vendedor: ${sanitizar(c.vendedorNombre)} · $${parseFloat(c.precio||0).toFixed(2)} · pendiente de contar: ${c.pendiente}</div>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button onclick="registrarVentaCerradaSinContar('${sanitizar(c.id)}','${sanitizar(c.codigo)}',${c.pendiente})" style="padding:5px 10px;font-size:11px;background:#52d68a;color:#111;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">💰 Registrar venta real</button>
                            <button onclick="eliminarConsignacionHuerfana('${sanitizar(c.id)}','${sanitizar(c.codigo)}')" style="padding:5px 10px;font-size:11px;background:#3a2a5a;color:#c4b5fd;border:none;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;">🗑️ Eliminar</button>
                        </div>
                    </div>`).join('')}
            </div>`;
        }
    }
    panel.innerHTML = html;
}

// Recupera una pieza cerrada por error con "Ya vendida" (marcada solo como
// liquidada, sin contar la venta) — la registra de verdad con REGISTRAR_VENTA
// para que sí cuente comisión y aparezca en el historial del vendedor, igual
// que si se hiciera desde su perfil.
async function registrarVentaCerradaSinContar(id, codigo, pendiente) {
    const fechaTxt = prompt(`Fecha real en que se vendió "${codigo}" (AAAA-MM-DD):`, new Date().toISOString().slice(0,10));
    if (!fechaTxt) return;
    const fechaISO = new Date(fechaTxt + "T12:00:00").toISOString();
    const res = await apiPost({ accion: "REGISTRAR_VENTA", id, cantidad: pendiente, fecha: fechaISO });
    if (!res.ok) { toast("⚠️ " + (res.error||"No se pudo registrar la venta"), "#c0392b"); return; }
    toast("✅ Venta registrada — ya cuenta para su comisión y aparece en su historial");
    ejecutarAuditoriaStock();
}

// Borra un registro de consignación de raíz (sin mover stock) — para casos
// huérfanos/de prueba que el panel de auditoría encontró, típicamente con un
// vendedor que ya no existe o un código que ya no existe en Stock, donde no
// hay perfil al que entrar para borrarlo con el botón normal.
async function eliminarConsignacionHuerfana(id, codigo) {
    if (!confirm(`¿Eliminar el registro de consignación de "${codigo}"? Es para limpiar datos de prueba/huérfanos — NO restaura nada a bodega, porque se asume que esa pieza nunca existió realmente. Si tienes dudas, cancela y revisa primero.`)) return;
    const res = await apiPost({ accion: "ELIMINAR_CONSIGNACION_SIN_RESTAURAR", id });
    if (res && res.ok !== false) {
        toast("🗑️ Registro eliminado");
        ejecutarAuditoriaStock();
    } else {
        toast("⚠️ " + (res?.error || "No se pudo eliminar"), "#c0392b");
    }
}

// A diferencia de "+ Existencia" (que solo SUMA), esto fija el número
// exacto de cada columna — para arreglar desajustes puntuales (ej. un
// duplicado eliminado que dejó el contador de consignación mal calculado).
async function corregirCantidadExactaStock(codigo) {
    const item = stockData.find(p => p.codigo === codigo);
    if (!item) return;
    const bodegaActual = parseInt(item.stock_bodega) || 0;
    const tiendaActual = parseInt(item.stock_tienda) || 0;
    const consigActual = parseInt(item.stock_consignacion) || 0;

    const nuevaBodega = prompt(`${codigo} — Bodega actual: ${bodegaActual}\n\nNueva cantidad exacta en BODEGA:`, bodegaActual);
    if (nuevaBodega === null) return;
    const nuevaTienda = prompt(`${codigo} — Tienda actual: ${tiendaActual}\n\nNueva cantidad exacta en TIENDA:`, tiendaActual);
    if (nuevaTienda === null) return;
    const nuevaConsig = prompt(`${codigo} — Consignación actual: ${consigActual}\n\nNueva cantidad exacta en CONSIGNACIÓN:`, consigActual);
    if (nuevaConsig === null) return;

    const b = Math.max(0, parseInt(nuevaBodega) || 0);
    const t = Math.max(0, parseInt(nuevaTienda) || 0);
    const c = Math.max(0, parseInt(nuevaConsig) || 0);

    if (!confirm(`Confirmar corrección de ${codigo}:\nBodega: ${bodegaActual} → ${b}\nTienda: ${tiendaActual} → ${t}\nConsignación: ${consigActual} → ${c}`)) return;

    try {
        const res = await apiPost({ accion: "STOCK_ACTUALIZAR_CANTIDADES", items: [{ codigo, stock_bodega: b, stock_tienda: t, stock_consignacion: c }] });
        if (res && res.ok !== false) {
            item.stock_bodega = b; item.stock_tienda = t; item.stock_consignacion = c;
            renderStock(stockData);
            toast("✅ Cantidades corregidas");
        } else {
            toast("⚠️ Error al corregir: " + (res?.error || "desconocido"));
        }
    } catch(e) { toast("⚠️ Error al corregir: " + e.message); }
}

// ── ELIMINAR PRODUCTO DESDE STOCK ────────────────────────────────────
async function eliminarStockItem(codigo) {
    if (!confirm(`¿Eliminar "${codigo}" del inventario?\nEsta acción no se puede deshacer.`)) return;
    const res = await apiPost({ accion: "ELIMINAR_PRODUCTO", codigo });
    if (res && res.ok !== false) {
        stockData = stockData.filter(p => p.codigo !== codigo);
        renderStock(stockData);
        toast("🗑️ Producto eliminado");
    } else {
        toast("⚠️ Error al eliminar", "#c0392b");
    }
}

// ── ASIGNAR A TIENDA ─────────────────────────────────────────────────
async function asignarATienda() {
    if (!stockSeleccionados.length) return;
    if (!confirm(`¿Publicar ${stockSeleccionados.length} producto(s) en la tienda online?`)) return;
    const res = await apiPost({ accion: "STOCK_ASIGNAR_TIENDA", codigos: stockSeleccionados, cantidad: 1 });
    if (res.ok) {
        toast(`✅ ${res.publicados?.length || stockSeleccionados.length} producto(s) publicados en tienda`);
        limpiarSeleccion();
        await cargarStock();
    } else {
        toast("⚠️ Error al publicar", "#c0392b");
    }
}

// ── ASIGNAR A VENDEDOR ───────────────────────────────────────────────
function abrirAsignarVendedor() {
    if (!stockSeleccionados.length) return;
    document.getElementById("stock-asignar-info").textContent = 
        `Se asignarán ${stockSeleccionados.length} producto(s) al vendedor seleccionado.`;
    const sel = document.getElementById("stock-vendedor-sel");
    sel.innerHTML = '<option value="">-- Seleccionar vendedor --</option>' +
        vendedores.map(v => `<option value="${v.codigo}">${v.nombre}</option>`).join('');
    abrirModal("modal-stock-asignar");
}

async function confirmarAsignarVendedor() {
    const vendedor = document.getElementById("stock-vendedor-sel").value;
    if (!vendedor) { toast("⚠️ Selecciona un vendedor"); return; }
    const res = await apiPost({ accion: "STOCK_ASIGNAR_VENDEDOR", codigos: stockSeleccionados, vendedor, cantidad: 1 });
    if (res.ok) {
        cerrarModal("modal-stock-asignar");
        limpiarSeleccion();
        await cargarStock();
        await cargarDatos();
        let msg = "";
        if (res.asignados && res.asignados.length > 0) {
            msg += "✅ Asignados: " + res.asignados.length + " productos. ";
        }
        if (res.sinStock && res.sinStock.length > 0) {
            msg += "⚠️ Sin stock en bodega: " + res.sinStock.join(", ");
            toast(msg, "#e67e22");
        } else {
            toast(msg || "✅ Productos asignados correctamente");
        }
    } else {
        toast("⚠️ Error al asignar", "#c0392b");
    }
}

// ── DEVOLVER A BODEGA ────────────────────────────────────────────────
async function devolverABodega() {
    if (!stockSeleccionados.length) return;
    if (!confirm(`¿Devolver ${stockSeleccionados.length} producto(s) a bodega?`)) return;
    // Detectar origen real según los contadores del producto
    const origen = (() => {
        const prod = stockData.find(p => p.codigo === stockSeleccionados[0]);
        if (!prod) return "tienda";
        const enConsig = parseInt(prod.stock_consignacion) || 0;
        const enTienda = parseInt(prod.stock_tienda) || 0;
        if (enConsig > 0 && enTienda === 0) return "consignacion";
        return "tienda";
    })();
    const res = await apiPost({ accion: "STOCK_DEVOLVER_BODEGA", codigos: stockSeleccionados, cantidad: 1, origen });
    if (res.ok) {
        toast("✅ Productos devueltos a bodega");
        limpiarSeleccion();
        await cargarStock();
    }
}

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
                            set_config: setConfig || undefined,
                    precio_caballero: precioCaballeroSN
                        });
                        if (r2.ok) guardados++;
                    }
                }
            }
            const codigosGuardados = _snMultiCodigos.filter((_, i) => i < guardados).map(x => ({ codigo: x.codigo, qty: x.qty || 1 }));
            const msgNuevos  = nuevos.length  ? `${nuevos.length} nueva${nuevos.length>1?"s":""}` : "";
            const msgRestock = restock.length ? `${restock.length} reabastecida${restock.length>1?"s":""}` : "";
            toast(`✅ ${[msgNuevos, msgRestock].filter(Boolean).join(" + ")} en bodega`);
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

// ── COLA DE ETIQUETAS (sesión) ────────────────────────────────────────
let _colaEtiquetas = []; // [{codigo, qty}] acumulados durante la sesión

function ofrecerEtiquetaRapida(items) {
    // items puede ser string[] (legacy) o {codigo,qty}[]
    if (!items || !items.length) return;
    items.forEach(item => {
        const cod = typeof item === 'string' ? item : item.codigo;
        const qty = typeof item === 'string' ? 1 : (item.qty || 1);
        const existing = _colaEtiquetas.find(x => x.codigo === cod);
        if (existing) existing.qty += qty;
        else _colaEtiquetas.push({ codigo: cod, qty });
    });
    renderBotonCola();
}

function _expandirCola() {
    return _colaEtiquetas.flatMap(x => Array(x.qty).fill(x.codigo));
}

function renderBotonCola() {
    let btn = document.getElementById("btn-cola-etiquetas");
    if (!_colaEtiquetas.length) { if (btn) btn.remove(); return; }

    const n = _colaEtiquetas.reduce((s, x) => s + x.qty, 0);
    const multiplo6 = Math.floor(n / 6) * 6;
    const resto = n % 6;
    let subtexto = "";
    if (multiplo6 > 0 && resto > 0) subtexto = `<div style="font-size:10px;color:#888;margin-top:2px;">${multiplo6} completas + ${resto} pendiente${resto>1?"s":""}</div>`;
    else if (multiplo6 > 0) subtexto = `<div style="font-size:10px;color:#22c55e;margin-top:2px;">¡Listo para imprimir!</div>`;
    else subtexto = `<div style="font-size:10px;color:#888;margin-top:2px;">${6-resto} más para completar hoja</div>`;

    if (!btn) {
        btn = document.createElement("div");
        btn.id = "btn-cola-etiquetas";
        btn.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:9998;
            background:#1a1a1a; border:1px solid #C9A84C; border-radius:14px;
            padding:10px 14px; box-shadow:0 4px 20px rgba(0,0,0,.7);
            animation: slideUpIn .25s ease; cursor:pointer; text-align:center;
            min-width:130px;
        `;
        document.body.appendChild(btn);
    }

    btn.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <button onclick="imprimirCola()" style="background:#C9A84C;color:#111;border:none;border-radius:8px;
                padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;flex:1;">
                🖨️ ${n} etiqueta${n>1?"s":""}
            </button>
            <button onclick="limpiarCola()" title="Limpiar cola"
                style="background:none;border:none;color:#555;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;">×</button>
        </div>
        ${subtexto}
    `;
}

function limpiarCola() {
    _colaEtiquetas = [];
    const btn = document.getElementById("btn-cola-etiquetas");
    if (btn) btn.remove();
}

async function imprimirCola() {
    if (!_colaEtiquetas.length) return;
    // Verificar si el Print Server local está vivo
    let serverVivo = false;
    try {
        const res = await Promise.race([
            fetch('http://127.0.0.1:7891/ping'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200))
        ]);
        serverVivo = res.ok;
    } catch(e) { serverVivo = false; }

    if (serverVivo) {
        abrirModalImpresion();
        return;
    }

    // Sin servidor de impresión no se puede mandar directo a la Brother. Antes
    // se descargaba el PDF en silencio y encima se limpiaba la cola: el usuario
    // apretaba "imprimir", le aparecía una descarga sin explicación y perdía lo
    // que había cargado. Ahora se avisa qué pasó y se decide.
    const seguir = confirm(
        "No se puede imprimir directo: la app VEREX Impresión no está abierta.\n\n" +
        "Ábrela desde el Hub y volvé a intentar.\n\n" +
        "¿Preferís descargar el PDF de las etiquetas para imprimirlo a mano?"
    );
    if (!seguir) return;   // se conserva la cola para reintentar con el Hub abierto

    await generarEtiquetaRapida(_expandirCola());
    limpiarCola();
}

// ── MODAL DE IMPRESIÓN DIRECTA ────────────────────────────────────────────
let _formatoImpresion = localStorage.getItem('verex_formato_impresion') || 'mini';
let _rolloImpresion = localStorage.getItem('verex_rollo_impresion') || 'mono';

function abrirModalImpresion() {
    let m = document.getElementById('modal-print-server');
    if (!m) {
        m = document.createElement('div');
        m.id = 'modal-print-server';
        m.style.cssText = `
            position:fixed;inset:0;z-index:10000;
            background:rgba(0,0,0,0.82);display:flex;
            align-items:center;justify-content:center;
        `;
        m.innerHTML = `
            <div style="background:#111;border:1px solid #C9A84C;border-radius:16px;
                        padding:20px;width:680px;max-width:97vw;font-family:'DM Sans',sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="color:#C9A84C;font-size:15px;font-weight:700;">🖨️ Imprimir etiquetas</span>
                    <button onclick="cerrarModalImpresion()" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <div style="display:flex;gap:16px;">
                    <!-- Columna izquierda: formatos + rollo -->
                    <div style="flex:1;min-width:0;">
                        <p style="color:#ccc;font-size:11px;margin-bottom:8px;font-weight:600;">Formato:</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;" id="print-format-grid">
                            <button onclick="selFormatoImpresion('mini',this)"
                                style="background:#C9A84C;color:#111;border:none;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                📎 Mini (DK-2214)<br><span style="font-size:9px;font-weight:400;">2×1.2cm · cinta 12mm</span>
                            </button>
                            <button onclick="selFormatoImpresion('mini2',this)" title="Misma mini de 2×1.2cm pero dos por etiqueta DK-1204 — se recortan por las guías punteadas. Para cuando no hay cinta DK-2214."
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                ✂️ Mini ×2<br><span style="font-size:9px;font-weight:400;">2×1.2cm en DK-1204</span>
                            </button>
                            <button onclick="selFormatoImpresion('producto',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ Producto<br><span style="font-size:9px;font-weight:400;">5×1.5cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('dk1204',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ DK-1204<br><span style="font-size:9px;font-weight:400;">5.4×1.7cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('dk2214',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ DK-2214 Grande<br><span style="font-size:9px;font-weight:400;">5×1.2cm · mismo rollo</span>
                            </button>
                            <button onclick="selFormatoImpresion('producto-v',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ DK Vertical<br><span style="font-size:9px;font-weight:400;">1.7×5.4cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('tarjeta25',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ Tarjeta<br><span style="font-size:9px;font-weight:400;">2.5×1.5cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('recibo',this)" style="grid-column:span 3;
                                background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🧾 Recibo &nbsp;·&nbsp; <span style="font-size:9px;font-weight:400;">62mm × dinámico</span>
                            </button>
                        </div>
                        <p style="color:#ccc;font-size:11px;margin-bottom:6px;font-weight:600;">🎞️ Rollo:</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;" id="print-rollo-grid">
                            <button onclick="selRolloImpresion('mono',this)"
                                style="background:#161616;color:#C9A84C;border:1px solid #C9A84C;border-radius:8px;
                                       padding:8px 4px;font-size:11px;font-weight:700;cursor:pointer;">
                                ⬜ Monocromo
                            </button>
                            <button onclick="selRolloImpresion('rojo',this)"
                                style="background:#161616;color:#666;border:1px solid #333;border-radius:8px;
                                       padding:8px 4px;font-size:11px;font-weight:700;cursor:pointer;">
                                🔴 Negro/Rojo
                            </button>
                        </div>
                    </div>
                    <!-- Columna derecha: preview + botones -->
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
                        <div id="print-preview-area" style="border-radius:8px;overflow:hidden;flex:1;margin-bottom:10px;min-height:80px;"></div>
                        <div id="print-server-status" style="font-size:11px;color:#888;margin-bottom:8px;min-height:14px;text-align:center;"></div>
                        <button onclick="enviarImpresionServidor()"
                            style="width:100%;background:linear-gradient(135deg,#C9A84C,#a87d20);
                                   color:#111;border:none;border-radius:10px;padding:12px;
                                   font-size:13px;font-weight:700;cursor:pointer;margin-bottom:6px;">
                            🖨️ Imprimir en Brother QL
                        </button>
                        <button onclick="descargarSoloPDF()"
                            style="width:100%;background:none;color:#666;border:1px solid #333;
                                   border-radius:10px;padding:8px;font-size:11px;cursor:pointer;">
                            ⬇️ Solo descargar PDF
                        </button>
                        <button onclick="reconectarImpresora()"
                            style="width:100%;background:none;color:#888;border:1px solid #333;
                                   border-radius:10px;padding:7px;font-size:11px;cursor:pointer;margin-top:5px;">
                            🔄 Reconectar impresora
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(m);
    }
    m.style.display = 'flex';
    // Restaurar formato persistido (o mini por defecto)
    _formatoImpresion = localStorage.getItem('verex_formato_impresion') || 'mini';
    document.querySelectorAll('#print-format-grid button').forEach(b => {
        const fmt = (b.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1];
        const activo = (fmt === _formatoImpresion);
        b.style.background = activo ? '#C9A84C' : '#222';
        b.style.color      = activo ? '#111'    : '#aaa';
        b.style.border     = activo ? 'none'    : '1px solid #333';
    });
    // Aplicar selección de rollo persistida
    document.querySelectorAll('#print-rollo-grid button').forEach((b, i) => {
        const esRollo = (i === 0 ? 'mono' : 'rojo');
        const activo = (esRollo === _rolloImpresion);
        const colorOn = (esRollo === 'rojo') ? '#ef4444' : '#C9A84C';
        b.style.background = activo ? (esRollo === 'rojo' ? 'rgba(239,68,68,.1)' : 'rgba(201,168,76,.1)') : '#161616';
        b.style.color      = activo ? colorOn : '#666';
        b.style.border     = '1px solid ' + (activo ? colorOn : '#333');
    });
    document.getElementById('print-server-status').textContent = '';
    setTimeout(actualizarPreviewImpresion, 50);
    // Auto-detectar impresora en background al abrir el modal
    _autoDetectarImpresora();
}

async function _autoDetectarImpresora() {
    const status = document.getElementById('print-server-status');
    // Si ya tenemos IP no hacer nada
    if (localStorage.getItem('verex_wifi_ip')) return;
    try {
        status.textContent = '🔍 Buscando impresora...';
        status.style.color = '#C9A84C';
        const res = await fetch(PRINT_SERVER + '/wifi-autoconnect', { signal: AbortSignal.timeout(12000) });
        const data = await res.json();
        if (data.ok && data.ip) {
            localStorage.setItem('verex_wifi_ip', data.ip);
            status.textContent = '✅ Impresora encontrada: ' + data.ip;
            status.style.color = '#22c55e';
            setTimeout(() => { if (status.textContent.includes('encontrada')) status.textContent = ''; }, 3000);
        } else {
            status.textContent = '⚠️ Impresora no encontrada en la red';
            status.style.color = '#ef4444';
        }
    } catch {
        // Servidor no disponible — silencioso
        status.textContent = '';
    }
}

function selRolloImpresion(rollo, btn) {
    _rolloImpresion = rollo;
    localStorage.setItem('verex_rollo_impresion', rollo);
    document.querySelectorAll('#print-rollo-grid button').forEach(b => {
        b.style.background = '#161616';
        b.style.color      = '#666';
        b.style.border     = '1px solid #333';
    });
    const esRojo = (rollo === 'rojo');
    btn.style.background = esRojo ? 'rgba(239,68,68,.1)' : 'rgba(201,168,76,.1)';
    btn.style.color      = esRojo ? '#ef4444' : '#C9A84C';
    btn.style.border     = '1px solid ' + (esRojo ? '#ef4444' : '#C9A84C');
}

function cerrarModalImpresion() {
    const m = document.getElementById('modal-print-server');
    if (!m) return;
    if (typeof m._onclose === 'function') { m._onclose(); m._onclose = null; }
    m.style.display = 'none';
}

const PRINT_SERVER = 'http://127.0.0.1:7891';

async function abrirWifiDesdeModal() {
    const panel = document.getElementById('wifi-consig-panel');
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const status = document.getElementById('wifi-consig-status');
    document.getElementById('wifi-consig-candidates').style.display = 'none';

    // Restaurar IP guardada localmente (siempre disponible aunque el server no esté)
    const ipLocal = localStorage.getItem('verex_wifi_ip');
    if (ipLocal) {
        document.getElementById('wifi-consig-ip').value = ipLocal;
        status.textContent = '⏳ Aplicando IP guardada...';
        status.style.color = '#C9A84C';
    }

    try {
        const res = await fetch(PRINT_SERVER + '/wifi', { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        const ipServidor = data.ip || ipLocal;
        if (ipServidor) {
            document.getElementById('wifi-consig-ip').value = ipServidor;
            localStorage.setItem('verex_wifi_ip', ipServidor);
            status.textContent = '✅ IP activa: ' + ipServidor;
            status.style.color = '#22c55e';
            // Sincronizar IP local al servidor si el servidor no la tenía
            if (!data.ip && ipLocal) {
                fetch(PRINT_SERVER + '/wifi', {
                    method: 'POST', body: JSON.stringify({ ip: ipLocal }),
                    headers: { 'Content-Type': 'application/json' }
                }).catch(() => {});
            }
        } else {
            wifiConsigAutoDescubrir();
        }
    } catch {
        if (ipLocal) {
            // Servidor no responde pero tenemos IP guardada — intentar abrirlo y aplicar
            status.textContent = '⏳ Iniciando app con IP: ' + ipLocal + '...';
            status.style.color = '#C9A84C';
            window.open('verex://open', '_self');
            let intentos = 0;
            const timer = setInterval(async () => {
                intentos++;
                try {
                    await fetch(PRINT_SERVER + '/wifi', {
                        method: 'POST', body: JSON.stringify({ ip: ipLocal }),
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(1500)
                    });
                    clearInterval(timer);
                    status.textContent = '✅ IP aplicada: ' + ipLocal;
                    status.style.color = '#22c55e';
                } catch {
                    if (intentos >= 8) {
                        clearInterval(timer);
                        status.textContent = 'App no disponible. IP guardada: ' + ipLocal;
                        status.style.color = '#888';
                    }
                }
            }, 2000);
        } else {
            status.textContent = '⏳ Abriendo app de impresión...';
            status.style.color = '#C9A84C';
            window.open('verex://open', '_self');
            let intentos = 0;
            const timer = setInterval(async () => {
                intentos++;
                try {
                    const r = await fetch(PRINT_SERVER + '/wifi', { signal: AbortSignal.timeout(1500) });
                    const d = await r.json();
                    clearInterval(timer);
                    if (d.ip) {
                        document.getElementById('wifi-consig-ip').value = d.ip;
                        localStorage.setItem('verex_wifi_ip', d.ip);
                        status.textContent = '✅ IP guardada: ' + d.ip;
                        status.style.color = '#22c55e';
                    } else {
                        wifiConsigAutoDescubrir();
                    }
                } catch {
                    if (intentos >= 8) {
                        clearInterval(timer);
                        status.textContent = 'No se pudo abrir la app. Ábrela manualmente.';
                        status.style.color = '#ef4444';
                    }
                }
            }, 2000);
        }
    }
}

async function wifiConsigAutoDescubrir() {
    const status = document.getElementById('wifi-consig-status');
    const btn = document.getElementById('btn-wifi-consig');
    status.textContent = '🔍 Buscando impresora automáticamente...';
    status.style.color = '#C9A84C';
    try {
        const res = await fetch(PRINT_SERVER + '/wifi-discover');
        const data = await res.json();
        if (data.found && data.found.length > 0) {
            const ip = data.found[0];
            document.getElementById('wifi-consig-ip').value = ip;
            status.textContent = '✅ Impresora encontrada y guardada: ' + ip;
            status.style.color = '#22c55e';
            btn.style.borderColor = '#22c55e';
            btn.style.color = '#22c55e';
        } else {
            // Fallback al escaneo completo
            status.textContent = '🔍 Escaneando red...';
            await wifiConsigScan();
        }
    } catch {
        status.textContent = 'No se pudo detectar la impresora';
        status.style.color = '#ef4444';
    }
}

async function wifiConsigScan() {
    const btn = document.getElementById('btn-wifi-consig-scan');
    const status = document.getElementById('wifi-consig-status');
    const cands = document.getElementById('wifi-consig-candidates');
    btn.textContent = '⏳ Buscando...';
    btn.disabled = true;
    status.textContent = 'Escaneando red, puede tardar ~20s...';
    status.style.color = '#C9A84C';
    cands.style.display = 'none';
    try {
        const res = await fetch(PRINT_SERVER + '/wifi-scan');
        const data = await res.json();
        if (data.found && data.found.length > 0) {
            cands.style.display = 'block';
            cands.innerHTML = data.found.map(ip =>
                `<div onclick="document.getElementById('wifi-consig-ip').value='${ip}';document.getElementById('wifi-consig-candidates').style.display='none';"
                    style="background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:7px 10px;
                           font-size:12px;color:#C9A84C;cursor:pointer;margin-bottom:4px;">
                    🖨️ ${ip}
                </div>`
            ).join('');
            status.textContent = `${data.found.length} impresora(s) encontrada(s)`;
            status.style.color = '#22c55e';
        } else {
            status.textContent = 'No se encontraron impresoras en la red';
            status.style.color = '#ef4444';
        }
    } catch {
        status.textContent = 'App de impresión no está abierta';
        status.style.color = '#ef4444';
    }
    btn.textContent = '🔍 Buscar';
    btn.disabled = false;
}

async function wifiConsigTest() {
    const ip = document.getElementById('wifi-consig-ip').value.trim();
    const status = document.getElementById('wifi-consig-status');
    if (!ip) { status.textContent = 'Ingresa una IP primero'; status.style.color = '#ef4444'; return; }
    status.textContent = 'Probando conexión...';
    status.style.color = '#C9A84C';
    try {
        const res = await fetch(PRINT_SERVER + '/wifi-test', {
            method: 'POST', body: JSON.stringify({ ip }),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
            status.textContent = '✅ Conexión exitosa';
            status.style.color = '#22c55e';
        } else {
            status.textContent = '❌ ' + (data.error || 'Sin respuesta');
            status.style.color = '#ef4444';
        }
    } catch {
        status.textContent = 'App de impresión no está abierta';
        status.style.color = '#ef4444';
    }
}

async function wifiConsigSave() {
    const ip = document.getElementById('wifi-consig-ip').value.trim();
    const status = document.getElementById('wifi-consig-status');
    if (!ip) { status.textContent = 'Ingresa una IP primero'; status.style.color = '#ef4444'; return; }
    try {
        const res = await fetch(PRINT_SERVER + '/wifi', {
            method: 'POST', body: JSON.stringify({ ip }),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
            localStorage.setItem('verex_wifi_ip', ip);
            status.textContent = '✅ IP guardada — la app imprimirá por WiFi';
            status.style.color = '#22c55e';
            const btn = document.getElementById('btn-wifi-consig');
            btn.style.borderColor = '#22c55e';
            btn.style.color = '#22c55e';
        } else {
            status.textContent = '❌ No se pudo guardar';
            status.style.color = '#ef4444';
        }
    } catch {
        status.textContent = 'App de impresión no está abierta';
        status.style.color = '#ef4444';
    }
}

function selFormatoImpresion(fmt, btn) {
    _formatoImpresion = fmt;
    localStorage.setItem('verex_formato_impresion', fmt);
    document.querySelectorAll('#print-format-grid button').forEach(b => {
        b.style.background = '#222';
        b.style.color      = '#aaa';
        b.style.border     = '1px solid #333';
    });
    btn.style.background = '#C9A84C';
    btn.style.color      = '#111';
    btn.style.border     = 'none';
    actualizarPreviewImpresion();
}

async function actualizarPreviewImpresion() {
    const area = document.getElementById('print-preview-area');
    if (!area) return;
    area.innerHTML = '<p style="color:#555;font-size:11px;text-align:center;padding:8px;">Generando vista previa…</p>';
    try {
        const codigos = _expandirCola();
        if (!codigos.length) { area.innerHTML = ''; return; }
        const pdfBase64 = await generarPDFParaServidor(codigos, _formatoImpresion);
        if (!pdfBase64) { area.innerHTML = ''; return; }
        area.innerHTML = `
            <p style="color:#666;font-size:10px;text-align:center;margin-bottom:4px;">Vista previa</p>
            <iframe src="data:application/pdf;base64,${pdfBase64}"
                style="width:100%;height:130px;border:1px solid #333;border-radius:6px;background:#fff;"
                scrolling="no"></iframe>`;
    } catch(e) {
        area.innerHTML = '<p style="color:#444;font-size:11px;text-align:center;padding:8px;">Vista previa no disponible</p>';
    }
}

async function reconectarImpresora() {
    const st = document.getElementById('print-server-status');
    if (st) st.innerHTML = '<span style="color:#C9A84C;">Buscando impresora...</span>';
    try {
        const r = await fetch('http://127.0.0.1:7891/wifi-autoconnect', { signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (d.ok && d.ip) {
            localStorage.setItem('verex_wifi_ip', d.ip);
            if (st) st.innerHTML = `<span style="color:#4caf50;">✓ Conectado: ${d.ip}</span>`;
        } else {
            if (st) st.innerHTML = '<span style="color:#e57373;">No se encontró la impresora. Verifica que esté encendida y en WiFi.</span>';
        }
    } catch(e) {
        if (st) st.innerHTML = '<span style="color:#e57373;">Servidor no disponible. Abre el servidor de impresión.</span>';
    }
}

async function enviarImpresionServidor() {
    const status = document.getElementById('print-server-status');
    status.style.color = '#C9A84C';
    status.textContent = '⏳ Generando PDF…';

    const codigos = _expandirCola();

    // 'mini2' arma un PDF de 54×17mm con DOS mini por página, así que:
    //  · a la impresora se le manda 'dk1204', que es el tamaño real del papel
    //    (el servidor no conoce 'mini2' y caería en un formato por defecto)
    //  · pageCount es la mitad — el Hub lo usa para calcular la altura de
    //    captura del PDF, y con el número equivocado sale cortado.
    const esMini2 = _formatoImpresion === 'mini2';
    const formatoImpresora = esMini2 ? 'dk1204' : _formatoImpresion;
    const pageCount = esMini2 ? Math.ceil(codigos.length / 2) : codigos.length;

    // 'mini' (DK-2214, cinta continua) tiene alto variable (px.h=0 en el Hub),
    // así que por defecto el Hub lo trata como tira continua sin cortes entre
    // páginas — correcto para una nota larga, pero al imprimir VARIOS códigos
    // de producto aplasta todos los QR en una sola etiqueta en vez de cortar
    // una por producto. separar:true fuerza al Hub a partir el PNG apilado y
    // cortar una etiqueta física por código, igual que ya hace la nota libre.
    const separarMini = _formatoImpresion === 'mini' && codigos.length > 1;

    let pdfBase64 = null;
    try {
        pdfBase64 = await generarPDFParaServidor(codigos, _formatoImpresion);
    } catch(err) {
        status.style.color = '#ef4444';
        status.textContent = '⚠️ Error PDF: ' + (err.message || err);
        return;
    }
    if (!pdfBase64) { status.style.color='#ef4444'; status.textContent='⚠️ Error generando PDF (null)'; return; }

    // Intentar servidor Electron (7891) — si no está, imprimir directo desde el navegador
    let serverVivo = false;
    try {
        const ping = await fetch(PRINT_SERVER + '/ping', { signal: AbortSignal.timeout(3000) });
        serverVivo = ping.ok;
    } catch {}

    if (serverVivo) {
        status.textContent = '📡 Enviando a impresora…';
        try {
            const res = await fetch(PRINT_SERVER + '/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formato: formatoImpresora, rollo: _rolloImpresion, pdf_base64: pdfBase64, pageCount, separar: separarMini, printerIp: localStorage.getItem('verex_wifi_ip') || undefined })
            });
            const json = await res.json();
            if (json.ok) {
                status.style.color = '#22c55e';
                status.textContent = `✅ ${json.etiquetas} etiqueta(s) enviadas a Brother QL`;
                if (_codigosImpresionRapida) { _codigosImpresionRapida.forEach(c => marcarEtiquetaImpresa(c)); _codigosImpresionRapida = null; }
                setTimeout(() => { cerrarModalImpresion(); limpiarCola(); renderStock(stockData); }, 1800);
            } else {
                const errMsg = (json.error || 'Error en impresora');
                // Traducir errores técnicos que el Hub no filtró
                const errLimpio = /WinError 10061|ConnectionRefused/i.test(errMsg)
                    ? 'Impresora apagada o fuera del WiFi — enciéndela e intentá de nuevo'
                    : /WinError 10060|timed out/i.test(errMsg)
                    ? 'Impresora no responde — verificá que esté encendida'
                    : /deprecat/i.test(errMsg)
                    ? errMsg.replace(/deprecation warning[^\n]*\n?/gi, '').trim() || 'Error en impresora'
                    : errMsg;
                status.style.color = '#ef4444';
                status.textContent = '⚠️ ' + errLimpio;
            }
        } catch(e) {
            status.style.color = '#ef4444';
            status.textContent = '⚠️ Error al enviar al servidor';
        }
    } else {
        // Imprimir directo desde el navegador sin app externa
        imprimirPDFNavegador(pdfBase64, pageCount);
        status.style.color = '#22c55e';
        status.textContent = '✅ Abriendo diálogo de impresión…';
        setTimeout(() => { cerrarModalImpresion(); limpiarCola(); }, 1200);
    }
}

function imprimirPDFNavegador(pdfBase64, pageCount) {
    // Dimensiones según formato (en mm)
    const dims = {
        mini:        { w: 20,   h: 12  },
        mini2:       { w: 47.92, h: 13.97 },  // area imprimible del troquel DK-1204
        dk2214:      { w: 50,   h: 12  },
        producto:    { w: 54,   h: 15  },
        'dk1204':    { w: 54,   h: 17  },
        'producto-v':{ w: 17,   h: 54  },
        tarjeta25:   { w: 50,   h: 15  },
        guia:        { w: 62,   h: 90  },
        recibo:      { w: 62,   h: 0   },
    };
    const d = dims[_formatoImpresion] || { w: 54, h: 15 };
    const orient = (d.w > d.h) ? 'landscape' : 'portrait';
    const cssSize = d.h > 0 ? `${d.w}mm ${d.h}mm` : `${d.w}mm auto`;

    const html = `<!DOCTYPE html><html><head>
<style>
  @page { size: ${cssSize} ${orient}; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; }
  embed { display: block; width: 100vw; height: 100vh; }
</style>
</head><body>
<embed src="data:application/pdf;base64,${pdfBase64}" type="application/pdf" width="100%" height="100%">
<script>
  window.onload = function() {
    // Dar tiempo a que el PDF renderice antes de imprimir
    setTimeout(function() { window.print(); }, 800);
  };
<\/script>
</body></html>`;

    const w = window.open('', '_blank', `width=${Math.round(d.w * 3.78)},height=${Math.round((d.h || 300) * 3.78 * pageCount)}`);
    if (w) { w.document.write(html); w.document.close(); }
}

async function descargarSoloPDF() {
    const codigos = [..._colaEtiquetas];
    cerrarModalImpresion();
    await generarEtiquetaRapida(codigos);
    limpiarCola();
}

// ═══════════════════════════════════════════════════════════════════════
// NOTA / TEXTO LIBRE — herramienta aparte para imprimir cualquier texto
// (ej. una nota para meter en el paquete de envío) en el rollo que esté
// puesto en ese momento en la Brother QL. Independiente del flujo de
// etiquetas de producto.
// ═══════════════════════════════════════════════════════════════════════
let _notaFormato = localStorage.getItem('verex_nota_formato') || 'producto';

// Escala manual del texto de la nota. El tamaño se sigue calculando solo para
// que el texto entre en la etiqueta, pero esto lo multiplica: sirve para pedir
// letra más grande en notas cortas (donde el automático se queda corto por el
// tope de 14pt) o más chica cuando se quiere que quede discreta.
// El auto-ajuste se mantiene SIEMPRE como tope, así nunca se desborda.
let _notaEscala = parseFloat(localStorage.getItem('verex_nota_escala')) || 1;

// Cuántas copias iguales imprimir de una sola vez. Se arma un PDF con una
// página por copia y se le pide al servidor que las separe en etiquetas
// distintas, en vez de mandar la misma nota N veces a mano.
let _notaCopias = parseInt(localStorage.getItem('verex_nota_copias')) || 1;

const NOTA_DIMS = {
    mini:         { w: 20, h: 12, label: '📎 Mini',       sub: '2×1.2cm · cinta' },
    producto:     { w: 54, h: 15, label: '🏷️ Producto',   sub: '5×1.5cm' },
    dk1204:       { w: 54, h: 17, label: '🏷️ DK-1204',    sub: '5.4×1.7cm' },
    dk2214:       { w: 50, h: 12, label: '🏷️ DK-2214',    sub: '5×1.2cm cinta' },
    'producto-v': { w: 17, h: 54, label: '🏷️ DK Vertical', sub: '1.7×5.4cm' },
    tarjeta25:    { w: 50, h: 15, label: '🏷️ Tarjeta',    sub: '2.5×1.5cm' },
    grande:       { w: 62, h: 90, label: '📦 Grande',     sub: '6.2×9cm · envíos' },
};

function abrirModalNota() {
    let m = document.getElementById('modal-nota-imprimir');
    if (!m) {
        m = document.createElement('div');
        m.id = 'modal-nota-imprimir';
        m.style.cssText = `
            position:fixed;inset:0;z-index:10000;
            background:rgba(0,0,0,0.82);display:flex;
            align-items:center;justify-content:center;
        `;
        const botonesFormato = Object.keys(NOTA_DIMS).map(fmt => {
            const d = NOTA_DIMS[fmt];
            const span = fmt === 'grande' ? 'grid-column:span 3;' : '';
            return `<button onclick="selFormatoNota('${fmt}',this)" data-fmt="${fmt}" style="${span}
                background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                ${d.label}<br><span style="font-size:9px;font-weight:400;">${d.sub}</span>
            </button>`;
        }).join('');
        m.innerHTML = `
            <div style="background:#111;border:1px solid #7a4ad4;border-radius:16px;
                        padding:20px;width:680px;max-width:97vw;font-family:'DM Sans',sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="color:#a47ae8;font-size:15px;font-weight:700;">📝 Nota / Texto libre</span>
                    <button onclick="cerrarModalNota()" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <div style="display:flex;gap:16px;">
                    <div style="flex:1;min-width:0;">
                        <p style="color:#ccc;font-size:11px;margin-bottom:8px;font-weight:600;">Formato del rollo:</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;" id="nota-format-grid">
                            ${botonesFormato}
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                            <span style="color:#ccc;font-size:11px;font-weight:600;flex:1;">Tamaño del texto:</span>
                            <button onclick="cambiarEscalaNota(-0.1)" title="Más chico"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">−</button>
                            <span id="nota-escala-val" style="color:#a47ae8;font-size:12px;font-weight:700;
                                       min-width:44px;text-align:center;">100%</span>
                            <button onclick="cambiarEscalaNota(0.1)" title="Más grande"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">+</button>
                            <button onclick="cambiarEscalaNota(0, true)" title="Volver al automático"
                                style="height:28px;padding:0 8px;background:#1a1a1a;color:#777;border:1px solid #333;
                                       border-radius:6px;font-size:10px;cursor:pointer;">auto</button>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                            <span style="color:#ccc;font-size:11px;font-weight:600;flex:1;">Copias a imprimir:</span>
                            <button onclick="cambiarCopiasNota(-1)" title="Una menos"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">−</button>
                            <input id="nota-copias-val" type="number" min="1" max="50" value="1"
                                onchange="fijarCopiasNota(this.value)"
                                style="width:52px;height:28px;background:#1a1a1a;color:#a47ae8;border:1px solid #333;
                                       border-radius:6px;text-align:center;font-size:13px;font-weight:700;
                                       font-family:'DM Sans',sans-serif;">
                            <button onclick="cambiarCopiasNota(1)" title="Una más"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">+</button>
                            <button onclick="fijarCopiasNota(1)" title="Volver a una sola"
                                style="height:28px;padding:0 8px;background:#1a1a1a;color:#777;border:1px solid #333;
                                       border-radius:6px;font-size:10px;cursor:pointer;">1×</button>
                        </div>
                        <p style="color:#ccc;font-size:11px;margin-bottom:6px;font-weight:600;">Texto a imprimir:</p>
                        <textarea id="nota-texto-libre" oninput="actualizarPreviewNota()" placeholder="Escribe aquí la nota…"
                            style="width:100%;min-height:90px;background:#1a1a1a;color:#eee;border:1px solid #333;
                                   border-radius:8px;padding:8px;font-size:12px;font-family:'DM Sans',sans-serif;resize:vertical;"></textarea>
                    </div>
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
                        <div id="nota-preview-area" style="border-radius:8px;overflow:hidden;flex:1;margin-bottom:10px;min-height:80px;"></div>
                        <div id="nota-status" style="font-size:11px;color:#888;margin-bottom:8px;min-height:14px;text-align:center;"></div>
                        <button onclick="enviarNotaImpresion()" id="nota-btn-imprimir"
                            style="width:100%;background:linear-gradient(135deg,#7a4ad4,#4a2a8c);
                                   color:#ede0ff;border:none;border-radius:10px;padding:12px;
                                   font-size:13px;font-weight:700;cursor:pointer;">
                            🖨️ Imprimir Nota
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(m);
    }
    m.style.display = 'flex';
    const activo = document.querySelector(`#nota-format-grid button[data-fmt="${_notaFormato}"]`);
    document.querySelectorAll('#nota-format-grid button').forEach(b => {
        b.style.background = '#222'; b.style.color = '#aaa'; b.style.border = '1px solid #333';
    });
    if (activo) { activo.style.background = '#7a4ad4'; activo.style.color = '#fff'; activo.style.border = 'none'; }
    refrescarEscalaNota();
    refrescarCopiasNota();
    actualizarPreviewNota();
}

function cerrarModalNota() {
    const m = document.getElementById('modal-nota-imprimir');
    if (m) m.style.display = 'none';
}

// delta = cuánto mover la escala; reset = volver al automático (100%).
// Se limita entre 50% y 200%: por debajo el texto es ilegible en una etiqueta
// de 5cm, y por encima el auto-ajuste lo termina recortando igual.
function cambiarEscalaNota(delta, reset) {
    _notaEscala = reset ? 1 : Math.min(2, Math.max(0.5, _notaEscala + delta));
    _notaEscala = Math.round(_notaEscala * 10) / 10;   // evita 0.7000000000000001
    localStorage.setItem('verex_nota_escala', String(_notaEscala));
    refrescarEscalaNota();
    actualizarPreviewNota();
}

function refrescarEscalaNota() {
    const el = document.getElementById('nota-escala-val');
    if (el) {
        el.textContent = Math.round(_notaEscala * 100) + '%';
        el.style.color = (_notaEscala === 1) ? '#a47ae8' : '#f0b429';
    }
}

// Tope de 50 copias: es una nota, no una tirada — y evita que un dedazo en el
// campo numérico mande cientos de etiquetas a la impresora.
function fijarCopiasNota(n) {
    _notaCopias = Math.max(1, Math.min(50, parseInt(n) || 1));
    localStorage.setItem('verex_nota_copias', String(_notaCopias));
    refrescarCopiasNota();
}

function cambiarCopiasNota(delta) {
    fijarCopiasNota(_notaCopias + delta);
}

function refrescarCopiasNota() {
    const inp = document.getElementById('nota-copias-val');
    if (inp) {
        inp.value = _notaCopias;
        inp.style.color = (_notaCopias === 1) ? '#a47ae8' : '#f0b429';
    }
    // El botón dice cuántas se van a imprimir, para que no haya sorpresas.
    const btn = document.getElementById('nota-btn-imprimir');
    if (btn) btn.textContent = (_notaCopias === 1)
        ? '🖨️ Imprimir Nota'
        : `🖨️ Imprimir ${_notaCopias} copias`;
}