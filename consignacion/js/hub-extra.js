
let _vdmFotoBase64 = "";
let _vdmQRStream   = null;
let _vdmQRInterval = null;

// ── IMPORTAR EXCEL ────────────────────────────────────────────────────
let _excelProductos = [];

function abrirImportarExcel() {
    _excelProductos = [];
    document.getElementById("excel-input").value = "";
    document.getElementById("excel-nombre-archivo").textContent = "";
    document.getElementById("excel-preview").style.display = "none";
    document.getElementById("excel-progreso").style.display = "none";
    document.getElementById("btn-importar-confirmar").disabled = true;
    abrirModal("modal-importar-excel");
}

function cargarExcel(input) {
    const file = input.files[0]; if (!file) return;
    document.getElementById("excel-nombre-archivo").textContent = "📄 " + file.name;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const wb   = XLSX.read(e.target.result, { type: "binary" });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
            if (!rows.length) { toast("⚠️ El archivo está vacío"); return; }

            // Normalizar columnas (case-insensitive)
            _excelProductos = rows.map(r => {
                const k = obj => Object.keys(obj).reduce((a,k) => { a[k.toLowerCase().trim()] = obj[k]; return a; }, {});
                const row = k(r);
                const dept = String(row.departamento || row.categoria || row.cat || "").toLowerCase();
                const matDetectado = row.material ? String(row.material).trim()
                    : dept.includes("oro laminado") ? "Plata 925 con Oro Laminado"
                    : dept.includes("oro")          ? "Oro"
                    : dept.includes("acero")        ? "Acero 316L"
                    : dept.includes("reloj")        ? "Reloj"
                    : dept.includes("plata")        ? "Plata Fina 925"
                    : "";
                const prefMat = matDetectado === "Plata Fina 925"             ? "P"
                              : matDetectado === "Plata 925 con Oro Laminado" ? "PO"
                              : matDetectado === "Acero 316L"                 ? "A"
                              : matDetectado === "Oro"                        ? "OR"
                              : matDetectado === "Reloj"                      ? "W"
                              : "";
                const codigoRaw = String(row.codigo || row.code || "").toUpperCase().trim();
                const codigoFinal = (prefMat && codigoRaw && !codigoRaw.startsWith(prefMat + "-"))
                    ? `${prefMat}-${codigoRaw}` : codigoRaw;
                return {
                    codigo:      codigoFinal,
                    nombre:      String(row.nombre      || row.name   || row.producto || row.descripcion || row.description || "").trim(),
                    precio:      parseFloat(row.precio  || row["precio de venta"] || row.price || 0),
                    categoria:   String(row.categoria   || row.cat    || row.departamento || "").toUpperCase().trim(),
                    cantidad:    parseInt(row.cantidad  || row.qty    || row.stock || row.inventario || 1),
                    material:    matDetectado,
                    talla:       String(row.talla       || row.size   || "").trim(),
                    descripcion: String(row.desc        || "").trim(),
                };
            }).filter(p => p.nombre || p.codigo);

            // Vista previa
            const cols = ["codigo","nombre","precio","categoria","cantidad","material","talla"];
            const thead = `<tr>${cols.map(c=>`<th style="padding:4px 8px;background:var(--gris);border:1px solid var(--borde);font-size:10px;white-space:nowrap;">${c}</th>`).join('')}</tr>`;
            const tbody = _excelProductos.slice(0,5).map(p =>
                `<tr>${cols.map(c=>`<td style="padding:3px 7px;border:1px solid var(--borde);font-size:10px;white-space:nowrap;">${p[c]||"—"}</td>`).join('')}</tr>`
            ).join('');
            document.getElementById("excel-tabla").innerHTML = `<table style="border-collapse:collapse;">${thead}${tbody}</table>`;
            document.getElementById("excel-resumen").textContent = `${_excelProductos.length} productos listos para importar`;
            document.getElementById("excel-preview").style.display = "block";
            document.getElementById("btn-importar-confirmar").disabled = false;
        } catch(e) {
            toast("⚠️ Error al leer el archivo: " + e.message);
        }
    };
    reader.readAsBinaryString(file);
}

async function confirmarImportacion() {
    if (!_excelProductos.length) return;
    const btn = document.getElementById("btn-importar-confirmar");
    btn.disabled = true;
    document.getElementById("excel-progreso").style.display = "block";
    const barra = document.getElementById("excel-barra");
    const txt   = document.getElementById("excel-progreso-txt");
    let ok = 0, err = 0;

    let omitidos = 0;
    for (let i = 0; i < _excelProductos.length; i++) {
        const p = _excelProductos[i];
        txt.textContent = `Importando ${i+1} de ${_excelProductos.length}...`;
        barra.style.width = Math.round((i+1)/_excelProductos.length*100) + "%";

        // Validar duplicado antes de importar
        if (p.codigo) {
            const existeDup = stockData.find(s => String(s.codigo).toUpperCase() === String(p.codigo).toUpperCase());
            if (existeDup) {
                omitidos++;
                continue; // saltar este producto
            }
        }

        try {
            const res = await apiPost({
                accion:      "STOCK_REGISTRAR",
                codigo:      p.codigo || undefined,
                codigoBase:  p.codigo || undefined,
                nombre:      p.nombre,
                nombre_base: p.nombre,
                precio:      p.precio,
                categoria:   p.categoria || "GEN",
                cantidad:    p.cantidad,
                material:    p.material,
                talla:       p.talla,
                descripcion: p.descripcion,
                estado:      "bodega"
            });
            if (res.ok) ok++; else err++;
        } catch(_) { err++; }
    }

    txt.textContent = `✅ ${ok} importados${omitidos > 0 ? ` · ⚠️ ${omitidos} código(s) duplicados omitidos` : ""}${err > 0 ? ` · ❌ ${err} errores` : ""}`;
    barra.style.width = "100%";
    barra.style.background = err > 0 ? "#e74c3c" : "#27ae60";
    toast(`✅ Importación: ${ok} nuevos${omitidos > 0 ? `, ${omitidos} omitidos por código duplicado` : ""}`);
    setTimeout(async () => {
        cerrarModal("modal-importar-excel");
        await cargarStock();
    }, 1500);
}

function descargarPlantillaExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
        ["codigo","nombre","precio","categoria","cantidad","material","talla","descripcion"],
        ["AN001T8","Anillo corazón zirconia",25,"AN",2,"Plata Fina 925","8","Anillo con motivo corazón"],
        ["CO001","Collar luna plata",18,"CO",3,"Plata Fina 925","","Collar con dije luna"],
        ["PU001","Pulsera acero trenzada",15,"PU",5,"Acero 316L","","Pulsera trenzada"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "plantilla_verex.xlsx");
}

// ── HISTORIAL VENTAS UNIFICADO ────────────────────────────────────────
let _historialVentas = [];

async function cargarHistorialVentas() {
    const lista = document.getElementById("lista-historial-ventas");
    lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "GET_HISTORIAL_VENTAS" });
        _historialVentas = res.ventas || [];
        poblarFiltroMesHistorial();
        renderHistorialVentas();
    } catch(e) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ Error al cargar.</p>';
    }
}

const MESES_HISTORIAL_VENTAS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
// Arma las opciones del filtro de mes a partir de los meses que realmente
// tienen ventas — no una lista fija de 12 meses que en su mayoría estaría
// vacía. Se recalcula cada vez que se recarga el historial (🔄), por si hay
// ventas nuevas de un mes que aún no tenía opción.
function poblarFiltroMesHistorial() {
    const sel = document.getElementById("hv-filtro-mes");
    if (!sel) return;
    const actual = sel.value;
    const clavesUnicas = [...new Set(_historialVentas.map(v => (v.fecha || "").slice(0, 7)).filter(Boolean))];
    clavesUnicas.sort().reverse(); // más reciente primero
    sel.innerHTML = '<option value="">Todos los meses</option>' +
        clavesUnicas.map(clave => {
            const [anio, mes] = clave.split("-");
            const nombreMes = MESES_HISTORIAL_VENTAS[parseInt(mes, 10) - 1] || mes;
            return `<option value="${clave}">${nombreMes} ${anio}</option>`;
        }).join("");
    if (clavesUnicas.includes(actual)) sel.value = actual;
}

function renderHistorialVentas() {
    const lista   = document.getElementById("lista-historial-ventas");
    const busq    = (document.getElementById("hv-buscar")?.value || "").toLowerCase();
    const filtTipo = document.getElementById("hv-filtro-tipo")?.value || "";
    const filtEst  = document.getElementById("hv-filtro-estado")?.value || "";
    const filtMes  = document.getElementById("hv-filtro-mes")?.value || "";

    let ventas = _historialVentas.filter(v => {
        if (filtTipo && v.tipo !== filtTipo) return false;
        if (filtEst  && v.estado !== filtEst) return false;
        if (filtMes  && (v.fecha || "").slice(0, 7) !== filtMes) return false;
        if (busq) {
            const hayCliente = (v.cliente || "").toLowerCase().includes(busq);
            let hayItem = false;
            // El placeholder dice "cliente o producto" pero solo comparaba
            // nombre — buscar directo por código (ej. al revisar cuándo se
            // vendió una pieza puntual) no encontraba nada.
            try { hayItem = JSON.parse(v.items||"[]").some(i => (i.nombre||"").toLowerCase().includes(busq) || (i.codigo||"").toLowerCase().includes(busq)); } catch(_) {}
            if (!hayCliente && !hayItem) return false;
        }
        return true;
    });

    // KPIs
    const hoy = new Date().toISOString().slice(0, 10);
    document.getElementById("hv-total-ventas").textContent = ventas.length;
    document.getElementById("hv-total-monto").textContent  = "$" + ventas.reduce((s,v) => s + v.total, 0).toFixed(2);
    document.getElementById("hv-pendiente").textContent    = "$" + ventas.reduce((s,v) => s + (v.saldoPendiente||0), 0).toFixed(2);
    document.getElementById("hv-hoy").textContent          = ventas.filter(v => (v.fecha||"").slice(0,10) === hoy).length;

    if (!ventas.length) { lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay ventas que coincidan.</p>'; return; }

    const tipoBadge = {
        directa:      { label: "💸 Venta Directa", bg: "rgba(14,165,233,0.2)",  color: "#0ea5e9" },
        catalogo:     { label: "🛍️ Catálogo",       bg: "rgba(39,174,96,0.2)",   color: "#4caf82" },
        consignacion: { label: "👤 Consignación",   bg: "rgba(201,168,76,0.2)", color: "var(--dorado)" },
        afiliado_sin_stock: { label: "🤝 Afiliado", bg: "rgba(122,74,212,0.2)", color: "#7a4ad4" }
    };
    const estadoBadge = {
        pagado:   { label: "✅ Pagado",   color: "#4caf82" },
        credito:  { label: "🕐 Crédito",  color: "#e8b07a" },
        pendiente:{ label: "⏳ Pendiente", color: "#e74c3c" }
    };
    const metodoPagoLabel = {
        efectivo: "💵 Efectivo", tarjeta: "💳 Tarjeta", transferencia: "🏦 Transferencia", credito: "🕐 Crédito"
    };

    lista.innerHTML = ventas.map(v => {
        const tb = tipoBadge[v.tipo] || tipoBadge.directa;
        const eb = estadoBadge[v.estado] || estadoBadge.pagado;
        const mpLabel = metodoPagoLabel[v.metodoPago] || "";
        const fecha = v.fecha ? new Date(v.fecha).toLocaleDateString("es-SV", { day:"2-digit", month:"short", year:"numeric" }) : "—";
        let itemsStr = "";
        try {
            const items = JSON.parse(v.items || "[]");
            itemsStr = items.slice(0, 2).map(i => `${i.nombre||""}${i.cantidad > 1 ? " ×"+i.cantidad : ""}`).join(", ");
            if (items.length > 2) itemsStr += ` +${items.length - 2} más`;
        } catch(_) {}

        return `<div style="background:#fff;border:3.5px solid ${tb.color};border-radius:10px;padding:12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
                        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:${tb.bg};color:${tb.color};font-weight:600;">${tb.label}</span>
                        <span style="font-size:10px;color:${eb.color};font-weight:600;">${eb.label}</span>
                        ${mpLabel ? `<span style="font-size:10px;color:#6b7280;font-weight:600;">${mpLabel}</span>` : ""}
                    </div>
                    <div style="font-size:13px;font-weight:700;color:#1a1a1a;">${sanitizar(v.afiliadoNombre || v.cliente)}</div>
                    <div style="font-size:11px;color:#374151;margin-top:2px;">${fecha} · Ref: ${String(v.id||"").slice(-6)}</div>
                    ${itemsStr ? `<div style="font-size:11px;color:#4b5563;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(itemsStr)}</div>` : ""}
                    ${v.nota ? `<div style="font-size:11px;color:#4b5563;font-style:italic;margin-top:2px;">${sanitizar(v.nota)}</div>` : ""}
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:15px;font-weight:700;color:#C9A84C;">$${parseFloat(v.total||0).toFixed(2)}</div>
                    ${v.saldoPendiente > 0 ? `<div style="font-size:11px;color:#e74c3c;font-weight:600;">Debe: $${parseFloat(v.saldoPendiente).toFixed(2)}</div>` : ""}
                </div>
            </div>
        </div>`;
    }).join('');
}

function abrirVDManual() {
    _vdmFotoBase64 = "";
    document.getElementById("vdm-nombre").value   = "";
    document.getElementById("vdm-precio").value   = "";
    document.getElementById("vdm-cantidad").value = "1";
    document.getElementById("vdm-codigo").value   = "";
    document.getElementById("vdm-sugerencias").style.display = "none";
    document.getElementById("vdm-foto-preview").innerHTML = "📷";
    document.getElementById("vdm-foto-preview").style.fontSize = "36px";
    document.getElementById("vdm-qr-area").style.display = "none";
    abrirModal("modal-vd-manual");
    setTimeout(() => document.getElementById("vdm-nombre").focus(), 200);
}

async function cargarFotoVDManual(input) {
    const file = input.files[0]; if (!file) return;
    _vdmFotoBase64 = await procesarFotoJoya(file);
    const prev = document.getElementById("vdm-foto-preview");
    prev.innerHTML = `<img src="${_vdmFotoBase64}" style="width:100%;height:100%;object-fit:cover;">`;
}

async function abrirQRManual() {
    const area   = document.getElementById("vdm-qr-area");
    const video  = document.getElementById("vdm-qr-video");
    const status = document.getElementById("vdm-qr-status");
    area.style.display = "block";
    try {
        _vdmQRStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = _vdmQRStream;
        await video.play();
        if ("BarcodeDetector" in window) {
            const detector = new BarcodeDetector({ formats: ["qr_code","code_128","code_39","ean_13"] });
            _vdmQRInterval = setInterval(async () => {
                try {
                    const codes = await detector.detect(video);
                    if (codes.length) {
                        cerrarQRManual();
                        const raw = codes[0].rawValue.trim().toUpperCase();
                        const prod = (stockData || []).find(s => (s.codigo || "").toUpperCase() === raw);
                        if (prod) {
                            seleccionarProdVDManual(prod.codigo);
                            toast("✅ " + prod.nombre + " encontrado");
                        } else {
                            toast("⚠️ Código " + raw + " no está en el inventario", "#f97316");
                        }
                    }
                } catch(_) {}
            }, 400);
        } else {
            cerrarQRManual();
            const cod = prompt("Ingresa el código:");
            if (cod) document.getElementById("vdm-codigo").value = cod.trim().toUpperCase();
        }
    } catch(e) {
        status.textContent = "⚠️ No se pudo acceder a la cámara";
    }
}

function cerrarQRManual() {
    clearInterval(_vdmQRInterval); _vdmQRInterval = null;
    if (_vdmQRStream) { _vdmQRStream.getTracks().forEach(t => t.stop()); _vdmQRStream = null; }
    document.getElementById("vdm-qr-area").style.display = "none";
}

function buscarVDManual(q) {
    const box = document.getElementById("vdm-sugerencias");
    const term = (q || "").trim().toUpperCase();
    if (term.length < 2) { box.style.display = "none"; return; }
    const matches = (stockData || []).filter(p =>
        p.estado !== "inactivo" &&
        ((p.codigo || "").toUpperCase().includes(term) ||
         (p.nombre || "").toUpperCase().includes(term))
    ).slice(0, 8);
    if (matches.length === 0) { box.style.display = "none"; return; }
    box.innerHTML = matches.map(p => {
        const stock = parseInt(p.stock_bodega || 0) + parseInt(p.stock_tienda || 0);
        const stockColor = stock > 0 ? "#4ade80" : "#f87171";
        const stockTxt  = stock > 0 ? `${stock} disponible${stock>1?"s":""}` : "Sin stock";
        return `<div onclick="seleccionarProdVDManual('${sanitizar(p.codigo)}')"
            style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid #2a2a2a;"
            onmouseover="this.style.background='#2a2a2a'" onmouseout="this.style.background='transparent'">
            ${p.foto ? `<img src="${sanitizar(p.foto)}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;">` : `<div style="width:36px;height:36px;border-radius:6px;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:16px;">💍</div>`}
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitizar(p.nombre)}</div>
                <div style="font-size:11px;color:#888;">${sanitizar(p.codigo)} · $${parseFloat(p.precio||0).toFixed(2)}</div>
            </div>
            <div style="font-size:10px;font-weight:700;color:${stockColor};white-space:nowrap;">${stockTxt}</div>
        </div>`;
    }).join("");
    box.style.display = "block";
}

function seleccionarProdVDManual(codigo) {
    const p = (stockData || []).find(s => s.codigo === codigo);
    if (!p) return;
    document.getElementById("vdm-nombre").value  = p.nombre || "";
    document.getElementById("vdm-codigo").value  = p.codigo;
    document.getElementById("vdm-precio").value  = parseFloat(p.precio || 0).toFixed(2);
    document.getElementById("vdm-sugerencias").style.display = "none";
    // guardar foto del stock
    document.getElementById("vdm-codigo").dataset.foto = p.foto || "";
    document.getElementById("vdm-cantidad").focus();
}

async function confirmarVDManual() {
    const nombre   = document.getElementById("vdm-nombre").value.trim();
    const precio   = parseFloat(document.getElementById("vdm-precio").value) || 0;
    const cantidad = parseInt(document.getElementById("vdm-cantidad").value) || 1;
    const codigoInput = document.getElementById("vdm-codigo").value.trim().toUpperCase();

    if (!nombre)  { toast("⚠️ Seleccioná un producto de la lista"); return; }
    if (!precio)  { toast("⚠️ Ingresa el precio"); return; }
    if (!codigoInput) {
        toast("⚠️ Debes seleccionar un producto del catálogo — el código es obligatorio para descontar stock", "#f97316");
        return;
    }

    // Verificar que el código existe en stock
    const prodStock = (stockData || []).find(s => s.codigo === codigoInput);
    if (!prodStock) {
        toast("⚠️ Código no encontrado en el inventario. Buscá el producto por nombre.", "#f97316");
        return;
    }
    const disponible = parseInt(prodStock.stock_bodega || 0) + parseInt(prodStock.stock_tienda || 0);
    const enCarrito  = (_vdCarrito[codigoInput]?.qty || 0);
    if (disponible - enCarrito < cantidad) {
        toast(`⚠️ Stock insuficiente: ${disponible} disponible${disponible===1?"":"s"}, ya tenés ${enCarrito} en el carrito`, "#f97316");
        return;
    }

    // Subir foto si hay — si no, usar la foto del stock
    let fotoUrl = prodStock.foto || "";
    if (_vdmFotoBase64) {
        const url = await subirFotoImageKit(_vdmFotoBase64, codigoInput);
        fotoUrl = url || _vdmFotoBase64;
    }

    const prod = { ...prodStock, precio, foto: fotoUrl };

    if (_vdCarrito[codigoInput]) {
        _vdCarrito[codigoInput].qty += cantidad;
    } else {
        _vdCarrito[codigoInput] = { prod, qty: cantidad };
    }
    cerrarQRManual();
    cerrarModal("modal-vd-manual");
    renderCarritoVD();
    filtrarVD();
    toast("✅ " + nombre + " agregado");
}

function abrirFotoZoom(url, nombre) {
    const modal = document.getElementById("modal-foto-zoom");
    document.getElementById("foto-zoom-img").src = ikFoto(url, 1500);
    const vista = esUrlMejorada(url) ? "✨ versión mejorada" : "foto original";
    document.getElementById("foto-zoom-nombre").textContent = (nombre || "") + " · " + vista;
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
}
function cerrarFotoZoom() {
    document.getElementById("modal-foto-zoom").style.display = "none";
    document.body.style.overflow = "";
}
