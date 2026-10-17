// Hub VEREX — Perfil del vendedor: borradores, verificación física, inventario, ventas y devoluciones
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
function toggleMenuProducto(id) {
    const menu = document.getElementById(id);
    if (!menu) return;
    const isVisible = menu.style.display === 'block';
    document.querySelectorAll('[id^="pmenu-"]').forEach(m => m.style.display = 'none');
    menu.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.style.display = 'none';
                document.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 100);
    }
}

async function eliminarProductoCatalogo(codigo) {
    // "codigo" puede ser el código completo ("AN-021-T10") o un código base ("AN-021")
    // Eliminar todas las variantes del mismo producto base
    const codigoBase = getCodigoBase(codigo);
    const variantes = Object.values(mapaProductos).filter(p => getCodigoBase(p.codigo) === codigoBase);
    if (!variantes.length) return;
    const nombre = variantes[0].nombre_base || variantes[0].nombre || codigoBase;
    if (!confirm("¿Eliminar " + nombre + " y todas sus variantes del catálogo?")) return;

    for (const p of variantes) {
        if (p.esNuevo) {
            const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
            localStorage.setItem("vx_prod_extras", JSON.stringify(extras.filter(x => x.codigo !== p.codigo)));
        } else {
            try { await apiPost({ accion: "ELIMINAR_PRODUCTO", codigo: p.codigo }); } catch(e) {}
        }
        productosDisponibles = productosDisponibles.filter(x => x.codigo !== p.codigo);
        delete mapaProductos[p.codigo];
        delete carritoEntrega[p.codigo];
    }
    toast("🗑️ " + nombre + " eliminado del catálogo");
    renderGridEntrega(productosDisponibles);
}

function toggleMenuVendedor(id) {
    const menu = document.getElementById(id);
    if (!menu) return;
    const isVisible = menu.style.display === 'block';
    // Close all menus first
    document.querySelectorAll('[id^="menu-VEN"]').forEach(m => m.style.display = 'none');
    menu.style.display = isVisible ? 'none' : 'block';
    // Close when clicking outside
    if (!isVisible) {
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.style.display = 'none';
                document.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 100);
    }
}

async function eliminarVendedor(codigo, nombre) {
    if (!confirm("¿Eliminar vendedor " + nombre + "? Esto no elimina su inventario.")) return;
    await apiPost({ accion: "ELIMINAR_VENDEDOR", codigo });
    vendedores = vendedores.filter(v => v.codigo !== codigo);
    renderVendedores();
    toast("🗑️ Vendedor eliminado");
}

async function editarNotasVendedor() {
    if (!vendedorActual) return;
    const nuevo = prompt("Notas internas (solo tú las ves):", vendedorActual.notas || "");
    if (nuevo === null) return;
    vendedorActual.notas = nuevo.trim();
    if (!vendedorActual.notas) delete vendedorActual.notas;
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    const notasTxt = document.getElementById("perfil-notas-txt");
    notasTxt.textContent = vendedorActual.notas || "+ Agregar nota interna...";
    notasTxt.style.color = vendedorActual.notas ? "" : "var(--plateado)";
    toast("✅ Notas actualizadas");
}

async function editarTipoVendedor() {
    if (!vendedorActual) return;
    const tipos = { consignacion: "📦 Consignación", afiliado: "🤝 Afiliado", hibrido: "🔄 Híbrido" };
    const opciones = Object.entries(tipos).map(([v, l]) => `${v === vendedorActual.tipo ? "✓ " : ""}${l} → ${v}`).join("\n");
    const input = prompt(`Tipo actual: ${tipos[vendedorActual.tipo] || vendedorActual.tipo}\n\nEscribe el nuevo tipo:\n  consignacion\n  afiliado\n  hibrido`, vendedorActual.tipo);
    if (!input || input.trim() === vendedorActual.tipo) return;
    const nuevo = input.trim().toLowerCase();
    if (!["consignacion", "afiliado", "hibrido"].includes(nuevo)) return toast("⚠️ Tipo inválido — usa: consignacion, afiliado o hibrido", "#f97316");
    if (!confirm(`¿Cambiar tipo de "${vendedorActual.nombre}" de ${tipos[vendedorActual.tipo]} → ${tipos[nuevo]}?`)) return;
    try {
        const res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "GUARDAR_VENDEDOR", vendedor: { ...vendedorActual, tipo: nuevo }, _pass: ADMIN_PASS }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error");
        vendedorActual.tipo = nuevo;
        const idx = vendedores.findIndex(v => v.codigo === vendedorActual.codigo);
        if (idx !== -1) vendedores[idx].tipo = nuevo;
        renderVendedores();
        abrirPerfil(vendedorActual.codigo);
        toast(`✅ Tipo actualizado a ${tipos[nuevo]}`, "#22c55e");
    } catch(e) {
        toast("❌ " + e.message, "#ef4444");
    }
}

async function editarComisionFija() {
    if (!vendedorActual) return;
    const actual = vendedorActual.comisionFija !== undefined && vendedorActual.comisionFija !== null ? String(vendedorActual.comisionFija) : "";
    const nuevo = prompt("% de comisión fija (deja vacío para usar la tabla por tramos):", actual);
    if (nuevo === null) return;
    const val = nuevo.trim();
    if (val === "") {
        delete vendedorActual.comisionFija;
    } else {
        const num = Math.min(100, Math.max(0, parseFloat(val)));
        if (isNaN(num)) { toast("⚠️ Ingresa un número válido"); return; }
        vendedorActual.comisionFija = num;
    }
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    abrirPerfil(vendedorActual.codigo);
    toast("✅ Comisión actualizada");
}

async function editarDui() {
    if (!vendedorActual) return;
    const nuevo = prompt("Documento Único de Identidad (DUI):", vendedorActual.dui || "");
    if (nuevo === null) return;
    const val = nuevo.trim();
    if (val === "") { delete vendedorActual.dui; } else { vendedorActual.dui = val; }
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    abrirPerfil(vendedorActual.codigo);
    toast("✅ DUI actualizado");
}

// El teléfono se guarda local (8 dígitos, sin "503") — el link de WhatsApp
// del catálogo ya lo normaliza solo al momento de usarlo, así que esto no es
// obligatorio para que funcione, pero deja el dato limpio en el sistema.
async function editarTelefonoVendedor() {
    if (!vendedorActual) return;
    const nuevo = prompt("Teléfono (8 dígitos, sin 503, ej: 71234567):", vendedorActual.telefono || "");
    if (nuevo === null) return;
    const val = nuevo.trim().replace(/\D/g, "");
    if (!val) return toast("⚠️ Teléfono vacío — sin cambios");
    vendedorActual.telefono = val;
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    abrirPerfil(vendedorActual.codigo);
    toast("✅ Teléfono actualizado");
}

async function editarPin() {
    if (!vendedorActual) return;
    const nuevo = prompt("PIN de 4 dígitos para proteger su inventario/portal (deja vacío para quitar el PIN):", vendedorActual.pin || "");
    if (nuevo === null) return;
    const val = nuevo.trim().replace(/\D/g, "").slice(0, 4);
    if (val === "") {
        delete vendedorActual.pin;
    } else if (val.length !== 4) {
        return toast("⚠️ El PIN debe tener exactamente 4 dígitos");
    } else {
        vendedorActual.pin = val;
    }
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    abrirPerfil(vendedorActual.codigo);
    toast("✅ PIN actualizado");
}

async function toggleActivoVendedor(codigo) {
    const v = vendedores.find(x => x.codigo === codigo);
    if (!v) return;
    v.activo = v.activo === false ? true : false;
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: v });
    renderVendedores();
    toast(v.activo ? "✅ Vendedor activado" : "⏸️ Vendedor desactivado — no aparecerá al generar catálogos");
}

function abrirPerfil(codigo) {
    vendedorActual = vendedores.find(v => v.codigo === codigo);
    if (!vendedorActual) return;
    document.getElementById("pantalla-vendedores").style.display = "none";
    document.getElementById("pantalla-perfil").style.display = "block";
    const inicial = (vendedorActual.nombre || "?")[0].toUpperCase();
    document.getElementById("perfil-avatar").textContent = inicial;
    document.getElementById("perfil-nombre").textContent = vendedorActual.nombre;
    document.getElementById("perfil-tel").textContent    = vendedorActual.codigo + " · " + vendedorActual.telefono;
    document.getElementById("perfil-dui").textContent    = vendedorActual.dui ? ("DUI: " + vendedorActual.dui) : "+ Agregar DUI...";
    const fReg = document.getElementById("perfil-fecha-reg");
    if (fReg) {
        const partes = ["Desde " + (vendedorActual.fechaRegistro ? new Date(vendedorActual.fechaRegistro).toLocaleDateString("es-SV",{day:"numeric",month:"short",year:"numeric"}) : "—")];
        if (vendedorActual.comisionFija !== undefined && vendedorActual.comisionFija !== null) partes.push(vendedorActual.comisionFija + "% comisión fija");
        const pinTxt = vendedorActual.pin ? `PIN: ${vendedorActual.pin}` : "Sin PIN";
        const tipoLabel = { consignacion: "📦 Consignación", afiliado: "🤝 Afiliado", hibrido: "🔄 Híbrido" }[vendedorActual.tipo] || vendedorActual.tipo;
        fReg.innerHTML = partes.join(" · ") + ` · ${tipoLabel} <span onclick="event.stopPropagation();editarTipoVendedor()" style="color:#0277bd;cursor:pointer;text-decoration:underline;">✏️ tipo</span>`
            + ' · <span onclick="event.stopPropagation();editarComisionFija()" style="color:#0277bd;cursor:pointer;text-decoration:underline;">✏️ comisión</span>'
            + ` · ${pinTxt} <span onclick="event.stopPropagation();editarPin()" style="color:#0277bd;cursor:pointer;text-decoration:underline;">✏️ PIN</span>`;
    }
    const notasWrap = document.getElementById("perfil-notas-wrap");
    const notasTxt  = document.getElementById("perfil-notas-txt");
    if (notasWrap && notasTxt) {
        notasWrap.style.display = "block";
        notasTxt.textContent = vendedorActual.notas || "+ Agregar nota interna...";
        notasTxt.style.color = vendedorActual.notas ? "" : "var(--plateado)";
    }

    // Un afiliado normal nunca maneja piezas físicas — oculta lo que solo aplica a consignación.
    // Excepción: si recibeFisico está activo, este afiliado SÍ recibe piezas para entregar,
    // así que se comporta igual que consignación en la parte logística.
    const esAfil = vendedorActual.tipo === "afiliado" || vendedorActual.tipo === "hibrido";
    const ocultarFisico = vendedorActual.tipo === "afiliado" && !vendedorActual.recibeFisico;
    const btnEntrega   = document.getElementById("btn-menu-entrega");
    const btnLinkInv   = document.getElementById("btn-menu-link-inv");
    const btnHistEnt   = document.getElementById("btn-menu-hist-entregas");
    const btnDevol     = document.getElementById("btn-menu-devolucion");
    const btnVentaMenu = document.getElementById("btn-menu-venta");
    const btnCorte     = document.getElementById("btn-menu-corte");
    const btnRecibos = document.getElementById("btn-menu-recibos");
    [btnEntrega, btnLinkInv, btnHistEnt, btnDevol, btnRecibos].forEach(b => { if (b) b.style.display = ocultarFisico ? "none" : ""; });
    // Cuando su pareja en el grid de 2 columnas se oculta, el botón restante ocupa todo el ancho
    if (btnVentaMenu) btnVentaMenu.style.gridColumn = ocultarFisico ? "1 / -1" : "";
    if (btnCorte)     btnCorte.style.gridColumn     = ocultarFisico ? "1 / -1" : "";
    if (btnVentaMenu) btnVentaMenu.querySelector(".menu-txt").textContent = ocultarFisico ? "Registrar Venta (Afiliado)" : "Registrar Venta";

    const btnContratoTxt = document.getElementById("btn-menu-contrato-txt");
    if (btnContratoTxt) {
        btnContratoTxt.textContent = vendedorActual.firmaContrato
            ? "Descargar Contrato — ✅ Firmado (digital)"
            : vendedorActual.firmadoFisico
                ? "Descargar Contrato — ✅ Firmado (papel)"
                : "Descargar Contrato — sin firmar";
    }
    // Solo se ofrece marcar "firmado en papel" si aún no hay ninguna firma registrada
    const btnMarcarFisico = document.getElementById("btn-marcar-firmado-fisico");
    if (btnMarcarFisico) {
        btnMarcarFisico.style.display = (!vendedorActual.firmaContrato && !vendedorActual.firmadoFisico) ? "" : "none";
    }
    // El portal de "Completar Pedidos" solo aplica a afiliados (catálogo digital + Leads)
    const btnLinkPedidos = document.getElementById("btn-menu-link-pedidos");
    if (btnLinkPedidos) btnLinkPedidos.style.display = esAfil ? "" : "none";
    // "Ver Catálogo Actual": afiliados y también quien tiene piezas en consignación
    // (arma el catálogo combinado — ver verCatalogoActualAfiliado).
    const btnVerCatalogo = document.getElementById("btn-menu-ver-catalogo");
    const tieneConsignacion = consignacion.some(c => c.vendedor === vendedorActual.codigo && c.estado === "activo");
    if (btnVerCatalogo) btnVerCatalogo.style.display = (esAfil || tieneConsignacion) ? "" : "none";

    const corteReal = corteAplica(vendedorActual) ? corteRealDe(vendedorActual) : null;
    const recordatorio = document.getElementById("recordatorio-corte");
    if (corteReal) {
        const vencimiento = corteReal.fecha;
        const dias = corteReal.dias;
        if (corteReal.manual && dias === 0) {
            recordatorio.style.display = "block";
            recordatorio.style.background = "rgba(192,57,43,0.2)";
            recordatorio.style.borderColor = "#c0392b";
            recordatorio.textContent = "🔴 El corte es hoy!";
        } else if (dias <= 0) {
            recordatorio.style.display = "block";
            recordatorio.style.background = "rgba(192,57,43,0.2)";
            recordatorio.style.borderColor = "#c0392b";
            recordatorio.textContent = "🚨 Corte vencido hace " + Math.abs(dias) + " dias!";
        } else if (dias <= 3) {
            recordatorio.style.display = "block";
            recordatorio.style.background = dias === 1 ? "rgba(192,57,43,0.2)" : "rgba(201,168,76,0.2)";
            recordatorio.style.borderColor = dias === 1 ? "#c0392b" : "#C9A84C";
            recordatorio.textContent = dias === 1 ? "🔴 El corte vence mañana!" : "⚠️ El corte vence en " + dias + " dias (" + vencimiento.toLocaleDateString("es-SV") + ")";
        } else {
            recordatorio.style.display = "none";
        }
    } else {
        recordatorio.style.display = "none";
    }
    renderProximoCortePerfil();
    cargarEntregasPendientesPerfil();
    renderPerfilStats();
    renderInventario();
    renderVentasPerfil();
    cargarDevolucionesPerfil();

    // Botón métricas y card — solo para afiliados, oculto hasta que se presione
    const btnMetricas = document.getElementById("btn-menu-metricas-cat");
    const cardCat = document.getElementById("perfil-catalogo-card");
    if (btnMetricas) btnMetricas.style.display = esAfil ? "" : "none";
    if (cardCat) { cardCat.style.display = "none"; cardCat.dataset.cargado = ""; }
}

function verMetricasCatalogo() {
    const cardCat = document.getElementById("perfil-catalogo-card");
    if (!cardCat) return;
    cardCat.style.display = "";
    if (!cardCat.dataset.cargado) {
        cardCat.dataset.cargado = "1";
        _cargarCatalogoPerfil(vendedorActual.codigo);
    }
    setTimeout(() => cardCat.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

let _devolucionesCache = [];

async function cargarDevolucionesPerfil() {
    const lista = document.getElementById("lista-devoluciones-perfil");
    if (!lista) return;
    lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await apiPost({ accion: "GET_DEVOLUCIONES_VENDEDOR", vendedor: vendedorActual.codigo });
        const devs = res.devoluciones || [];
        if (!devs.length) {
            lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">Sin devoluciones registradas.</p>';
            return;
        }
        _devolucionesCache = devs.slice().reverse();
        lista.innerHTML = _devolucionesCache.map((dev, idx) => {
            const fechaRaw = dev.fecha || dev.date || dev.createdAt || "";
            const fechaObj = fechaRaw ? new Date(fechaRaw) : null;
            const fecha = fechaObj && !isNaN(fechaObj) ? fechaObj.toLocaleDateString("es-SV", { year:"numeric", month:"short", day:"numeric" }) : "Sin fecha";
            const items = typeof dev.items === "string" ? (JSON.parse(dev.items) || []) : (dev.items || []);
            // Los registros viejos no traían total_unidades (salía "0 unidades"): se calcula desde los items.
            const total = parseInt(dev.total_unidades) || items.reduce((a, i) => a + (parseInt(i.cantidad) || 0), 0);
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--gris2);border:1px solid var(--borde);border-radius:10px;margin-bottom:8px;">
                <div>
                    <div style="font-size:12px;font-weight:700;color:var(--dorado);">${sanitizar(dev.id || "DEV-" + (idx+1))}</div>
                    <div style="font-size:13px;color:var(--blanco);margin:2px 0;">${fecha} · ${total} unidad${total!==1?'es':''}</div>
                    <div style="font-size:11px;color:var(--plateado);">${items.map(i=>sanitizar(i.nombre)+'×'+i.cantidad).join(', ')}</div>
                </div>
                <button onclick="descargarPDFDevolucion(${idx})"
                    style="background:linear-gradient(135deg,#7a5500,#C9A84C,#f0d060,#C9A84C,#7a5500);color:#1a0e00;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
                    ⬇️ PDF
                </button>
            </div>`;
        }).join('');
    } catch(e) {
        lista.innerHTML = '<p style="color:#e74c3c;font-size:13px;">⚠️ Error cargando devoluciones</p>';
    }
}

function descargarPDFDevolucion(idx) {
    const dev = _devolucionesCache[idx];
    if (!dev) return;
    const { jsPDF } = window.jspdf;
    const doc  = new jsPDF({ unit:'mm', format:'a4' });
    const pageW = 210;
    const fechaRaw = dev.fecha || dev.date || dev.createdAt || "";
    const fechaObj = fechaRaw ? new Date(fechaRaw) : null;
    const fecha = fechaObj && !isNaN(fechaObj) ? fechaObj.toLocaleDateString("es-SV", { year:"numeric", month:"long", day:"numeric" }) : new Date().toLocaleDateString("es-SV", { year:"numeric", month:"long", day:"numeric" });
    const items = typeof dev.items === "string" ? (JSON.parse(dev.items) || []) : (dev.items || []);
    const devId = dev.id || ("DEV-" + (idx+1));
    // Encabezado
    doc.setFillColor(10,10,10); doc.rect(0,0,pageW,40,'F');
    doc.setFont("helvetica","normal"); doc.setFontSize(22); doc.setTextColor(201,168,76);
    doc.text("VEREX", pageW/2, 18, {align:"center"});
    doc.setFontSize(10); doc.setTextColor(180,180,180);
    doc.text("RECIBO DE DEVOLUCIÓN", pageW/2, 26, {align:"center"});
    doc.setFontSize(9); doc.text(fecha, pageW/2, 34, {align:"center"});
    // Info vendedor
    doc.setTextColor(30,30,30); doc.setFontSize(11); doc.setFont("helvetica","normal");
    doc.text("Vendedor:", 20, 52); doc.setFont("helvetica","normal");
    doc.text(vendedorActual.nombre + "  |  " + vendedorActual.codigo, 52, 52);
    doc.setFont("helvetica","normal"); doc.text("N° Devolución:", 20, 60);
    doc.setFont("helvetica","normal"); doc.text(String(devId), 62, 60);
    // Línea
    doc.setDrawColor(201,168,76); doc.setLineWidth(0.5); doc.line(20,65,pageW-20,65);
    // Tabla (con salto de página: antes las filas pasadas de ~24 se dibujaban fuera de la hoja y se perdían, igual que el total)
    const encabezadoTabla = (yy) => {
        doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.setTextColor(80,80,80);
        doc.text("Producto", 22, yy); doc.text("Código", 120, yy); doc.text("Cant.", 175, yy);
        doc.setDrawColor(200,200,200); doc.line(20,yy+3,pageW-20,yy+3);
    };
    encabezadoTabla(74);
    const limiteY = 272;                       // deja espacio para el pie de página
    let y = 84;
    items.forEach(item => {
        if (y > limiteY) { doc.addPage(); encabezadoTabla(20); y = 30; }
        doc.setFont("helvetica","normal"); doc.setTextColor(30,30,30); doc.setFontSize(10);
        doc.text(String(item.nombre||"").slice(0,45), 22, y);
        doc.text(String(item.codigo||""), 120, y);
        doc.text(String(item.cantidad||0), 178, y);
        y += 9;
    });
    const totalUnidades = items.reduce((s,i) => s + (parseInt(i.cantidad)||0), 0);
    if (y + 16 > limiteY + 9) { doc.addPage(); y = 24; }
    doc.setDrawColor(201,168,76); doc.line(20,y,pageW-20,y);
    doc.setFont("helvetica","normal"); doc.setFontSize(11); doc.setTextColor(30,30,30);
    doc.text("Total productos: " + items.length + "   |   Total unidades devueltas: " + totalUnidades, 22, y+9);
    // Pie en cada página
    const nPag = doc.getNumberOfPages();
    for (let pg = 1; pg <= nPag; pg++) {
        doc.setPage(pg);
        doc.setFontSize(8); doc.setTextColor(150,150,150); doc.setFont("helvetica","normal");
        doc.text("VEREX Store — Documento generado automáticamente  ·  Página " + pg + " de " + nPag, pageW/2, 285, {align:"center"});
    }
    doc.save("Devolucion-" + devId + ".pdf");
}

// Mismo mapa de categorías que usa el catálogo público, para que el
// desglose del borrador hable el mismo idioma que el resto del sistema.
const CAT_INFO_BORRADOR = {
    AN: "💍 Anillos", CO: "📿 Collares", AR: "✨ Aretes",
    PU: "⌚ Pulseras", CJ: "🎁 Conjuntos", CD: "🔗 Cadenas",
    DJ: "🌟 Dijes", TB: "🦶 Tobilleras", RS: "📿 Rosarios",
    RE: "⌚ Relojes", CA: "🔗 Cadenas solas"
};

function renderBannerBorradores() {
    const banner = document.getElementById("banner-borradores");
    if (!banner || !vendedorActual) return;
    const borradores = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "borrador");
    if (borradores.length > 0) {
        const totalPiezas = borradores.reduce((s, c) => s + (parseInt(c.cantidad)||1), 0);
        document.getElementById("banner-borradores-txt").textContent = totalPiezas + " pieza" + (totalPiezas !== 1 ? "s" : "");

        // Desglose por categoría (anillos, aretes, etc.)
        const porCategoria = {};
        borradores.forEach(c => {
            const pref = (c.categoria || getCodigoBase(c.codigo).match(/^[A-Z]+/)?.[0] || "GEN").toUpperCase();
            porCategoria[pref] = (porCategoria[pref] || 0) + (parseInt(c.cantidad) || 1);
        });
        const desglose = document.getElementById("banner-borradores-desglose");
        if (desglose) {
            desglose.innerHTML = Object.entries(porCategoria)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, cant]) => `<span style="display:inline-block;margin:2px 6px 2px 0;background:rgba(74,111,165,0.18);border-radius:12px;padding:2px 9px;font-size:11px;">${CAT_INFO_BORRADOR[cat] || cat} × ${cant}</span>`)
                .join('');
        }
        banner.style.display = "block";
        if (_modoVerificarBorrador) renderDetalleBorradores();
    } else {
        banner.style.display = "none";
        _modoVerificarBorrador = false;
        _verificadosBorrador.clear();
    }
}

function toggleDetalleBorradores() {
    const det = document.getElementById("banner-borradores-detalle");
    if (!det) return;
    const abrir = det.style.display === "none";
    det.style.display = abrir ? "block" : "none";
    document.getElementById("btn-detalle-borradores-txt").textContent = abrir ? "Ocultar lista" : "Ver lista completa (para contar físicamente)";
    if (abrir) renderDetalleBorradores();
}

// ── Verificación física por reescaneo ────────────────────────────────
// El admin re-escanea cada pieza que tiene en mano; cada código que
// coincide con la lista guardada se marca "✅ verificado". Al final, lo
// que quede sin marcar es exactamente lo que falta físicamente.
let _modoVerificarBorrador = false;
let _verificadosBorrador = new Set();

function toggleVerificacionFisica() {
    _modoVerificarBorrador = !_modoVerificarBorrador;
    if (_modoVerificarBorrador) {
        _verificadosBorrador.clear();
        document.getElementById("btn-verificar-fisico-txt").textContent = "🟢 Modo activo — escanea cada pieza física";
        document.getElementById("banner-borradores-detalle").style.display = "block";
        document.getElementById("btn-detalle-borradores-txt").textContent = "Ocultar lista";
        // Crítico: si el botón se queda con el foco, el "Enter" que manda el
        // lector físico al terminar cada escaneo es interpretado por el
        // navegador como "volver a tocar este botón" — reactivando el modo
        // y borrando el conteo a mitad de la verificación.
        document.activeElement?.blur();
    } else {
        document.getElementById("btn-verificar-fisico-txt").textContent = "Verificar conteo — escanea cada pieza";
    }
    renderDetalleBorradores();
}

function renderDetalleBorradores() {
    const det = document.getElementById("banner-borradores-detalle");
    if (!det || !vendedorActual) return;
    const borradores = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "borrador");
    det.innerHTML = borradores.map(c => {
        const verificado = _verificadosBorrador.has(c.codigo);
        const marcaOk = _modoVerificarBorrador ? (verificado ? "✅" : "⏳") : "";
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 6px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;
                ${_modoVerificarBorrador && !verificado ? 'background:rgba(231,76,60,0.08);' : ''}">
            <span>${marcaOk} <strong style="color:var(--dorado);">${sanitizar(c.codigo)}</strong> — ${sanitizar(c.nombre)} ${(c.cantidad>1)?('×'+c.cantidad):''}</span>
            <button onclick="eliminarUnBorrador('${String(c.id).replace(/'/g,"\\'")}','${sanitizar(c.nombre).replace(/'/g,"\\'")}')" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:14px;padding:2px 6px;">✕</button>
        </div>`;
    }).join('');
    if (_modoVerificarBorrador) {
        const total = borradores.length;
        const ok    = borradores.filter(c => _verificadosBorrador.has(c.codigo)).length;
        det.insertAdjacentHTML('afterbegin', `<div style="text-align:center;font-weight:700;color:${ok===total?'#52d68a':'#e8b07a'};padding:6px;font-size:13px;">${ok} / ${total} verificados</div>`);
    }
}

function _onScanVerificarBorrador(codRaw) {
    const codigo = String(codRaw || "").trim().toUpperCase();
    if (!codigo || !vendedorActual) return;
    const borradores = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "borrador");
    const codigoNorm = _normalizarCodigoScanner(codigo);
    let match = borradores.find(c => String(c.codigo).toUpperCase() === codigo);
    if (!match) match = borradores.find(c => _normalizarCodigoScanner(c.codigo) === codigoNorm);
    if (!match) {
        for (let recorte = 1; recorte <= 3 && !match; recorte++) {
            match = borradores.find(c => _normalizarCodigoScanner(c.codigo).slice(recorte) === codigoNorm);
        }
    }
    if (!match) {
        toast("⚠️ \"" + codigo + "\" no está en la lista de este borrador");
        return;
    }
    if (_verificadosBorrador.has(match.codigo)) {
        toast("↩️ " + match.nombre + " ya estaba verificado");
        return;
    }
    _verificadosBorrador.add(match.codigo);
    renderDetalleBorradores();
    const total = borradores.length;
    const ok    = _verificadosBorrador.size;
    toast("✅ " + match.nombre + " verificado (" + ok + "/" + total + ")");
}

async function eliminarUnBorrador(id, nombre) {
    if (!confirm("¿Quitar " + nombre + " de este borrador? El stock vuelve a bodega.")) return;
    try {
        await apiPost({ accion: "ELIMINAR_ITEM_CONSIGNACION", id });
        const idx = consignacion.findIndex(c => String(c.id) === String(id));
        if (idx >= 0) consignacion.splice(idx, 1);
        toast("🗑️ " + nombre + " quitado — stock devuelto a bodega");
        renderPerfilStats();
        renderInventario();
    } catch(e) { toast("⚠️ Error al quitar: " + e.message); }
}

// Este es el momento de la entrega física real: el vendedor recibe TODO lo
// acumulado en borrador y firma una sola vez. Al firmar, se publican todos
// los borradores (pasan a "activo" y aparecen en su link) y se genera un
// único recibo PDF con la lista completa.
let _borradoresParaFinalizar = [];

async function borrarBorradoresVendedor() {
    if (!vendedorActual) return;
    const borradores = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "borrador");
    if (!borradores.length) return;
    if (!confirm("¿Borrar los " + borradores.length + " producto(s) del borrador de " + vendedorActual.nombre + "? El stock vuelve a bodega y podrás volver a escanear desde cero.")) return;
    try {
        const res = await apiPost({ accion: "BORRAR_BORRADORES_VENDEDOR", vendedor: vendedorActual.codigo });
        consignacion = consignacion.filter(c => !(c.vendedor === vendedorActual.codigo && c.estado === "borrador"));
        toast("🗑️ " + (res.eliminados||0) + " producto(s) borrados — stock devuelto a bodega");
        renderPerfilStats();
        renderInventario();
    } catch(e) { toast("⚠️ Error al borrar: " + e.message); }
}

function finalizarBorradoresVendedor() {
    if (!vendedorActual) return;
    _borradoresParaFinalizar = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "borrador");
    if (!_borradoresParaFinalizar.length) return;

    _firmaCodigoActual = generarCodigoFirma();
    document.getElementById("firma-vendedor-nombre").textContent = vendedorActual.nombre + " — recibe " + _borradoresParaFinalizar.length + " producto(s)";
    document.getElementById("firma-codigo").textContent = _firmaCodigoActual;
    limpiarFirma();
    abrirModal("modal-firma");
    inicializarCanvasFirma();
    const btnConfirmar = document.getElementById("btn-confirmar-firma");
    if (btnConfirmar) btnConfirmar.setAttribute("onclick", "confirmarFinalizacionBorradores()");
}

async function confirmarFinalizacionBorradores() {
    if (!_firmaActiva) { toast("⚠️ El vendedor debe firmar primero"); return; }
    const firmaImg = document.getElementById("firma-canvas").toDataURL("image/png");
    cerrarModal("modal-firma");

    try {
        const res = await apiPost({ accion: "FINALIZAR_ENTREGA_VENDEDOR", vendedor: vendedorActual.codigo });
        // Solo marcar como activos localmente los que REALMENTE se publicaron
        // en el servidor — si algo falló a mitad del lote, se queda en
        // borrador (visible en el banner) para reintentarlo, en vez de
        // asumir que todo salió bien.
        const idsPublicados = new Set(res.publicadosIds || []);
        consignacion.forEach(c => {
            if (c.vendedor === vendedorActual.codigo && c.estado === "borrador" && idsPublicados.has(c.id)) c.estado = "activo";
        });

        const fallidos = res.fallidos || [];
        if (fallidos.length > 0) {
            toast("⚠️ " + (res.publicados||0) + " publicados, " + fallidos.length + " FALLARON — quedan en el banner para reintentar");
        } else {
            toast("✅ " + (res.publicados||0) + " producto(s) entregados y publicados en el link del vendedor");
        }
        const vendedorParaPDF = { ...vendedorActual };
        const itemsPDF = _borradoresParaFinalizar.filter(c => idsPublicados.has(c.id));
        renderPerfilStats();
        renderInventario();

        // Guardar un registro permanente del recibo (items + firma) para
        // poder volver a descargarlo después desde el Historial — antes el
        // PDF solo se descargaba una vez al momento y no quedaba ningún
        // rastro si el admin lo perdía o cerraba el navegador sin guardarlo.
        if (itemsPDF.length) {
            try {
                await apiPost({
                    accion: "REGISTRAR_ENTREGA_PENDIENTE",
                    vendedor: vendedorActual.codigo,
                    items: itemsPDF,
                    codigoRecibo: _firmaCodigoActual,
                    firmaImg,
                    estado: "confirmado"
                });
            } catch(e) { console.warn("No se pudo guardar el recibo en el historial:", e); }

            setTimeout(() => {
                try { generarReciboPDF(vendedorParaPDF, itemsPDF, firmaImg, _firmaCodigoActual); }
                catch(e) { console.error("Error generando recibo PDF:", e); toast("⚠️ Error al generar PDF: " + e.message); }
            }, 400);
        }
    } catch(e) {
        toast("⚠️ Error al finalizar: " + e.message);
    } finally {
        // Restaurar el botón de firma a su comportamiento normal (entrega directa)
        const btnConfirmar = document.getElementById("btn-confirmar-firma");
        if (btnConfirmar) btnConfirmar.setAttribute("onclick", "confirmarEntregaConFirma()");
    }
}

function renderPerfilStats() {
    renderBannerBorradores();
    const inv = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "activo");
    const stock   = inv.reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);
    const vendido = inv.reduce((s, c) => s + parseInt(c.vendido||0), 0);
    const valor   = inv.reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)) * parseFloat(c.precio||0), 0);
    document.getElementById("stat-stock").textContent   = stock;
    document.getElementById("stat-vendido").textContent = vendido;
    document.getElementById("stat-valor").textContent   = "$" + valor.toFixed(2);

    // Comisión acumulada EN VIVO desde el último corte — misma cuenta exacta
    // que usa "Hacer Corte" (mismo inv "activo", misma tabla de tramos/fija),
    // así el número que ve el admin aquí siempre calza con lo que saldría al
    // cortar en ese momento.
    const wrap = document.getElementById("stat-comision-wrap");
    if (wrap) {
        if (vendedorActual.tipo === "afiliado" || vendedorActual.tipo === "hibrido") {
            const valorVend = inv.reduce((s, c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);
            const pct       = calcularComision(valorVend, vendedorActual.tipo, vendedorActual.comisionFija);
            const ganancia  = valorVend * pct / 100;
            wrap.style.display = "";
            document.getElementById("stat-comision").textContent = "$" + ganancia.toFixed(2);
            document.getElementById("stat-comision-label").textContent = `Comisión (${pct}%) sin cortar`;
        } else {
            wrap.style.display = "none";
        }
    }
}

function renderInventario() {
    const inv = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "activo");
    const lista = document.getElementById("lista-inventario");
    if (!inv.length) { lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">No hay productos en inventario.</p>'; return; }
    lista.innerHTML = inv.map(c => {
        const disponible = parseInt(c.cantidad||0) - parseInt(c.vendido||0);
        return `<div class="inv-item">
            <img src="${sanitizar(ikFoto(c.foto,200)) || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2252%22 height=%2252%22><rect width=%2252%22 height=%2252%22 fill=%22%232a2a2a%22/></svg>'}"
                onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2252%22 height=%2252%22><rect width=%2252%22 height=%2252%22 fill=%22%232a2a2a%22/></svg>'">
            <div class="inv-item-info">
                <div class="inv-item-codigo">${sanitizar(c.codigo)}</div>
                <div class="inv-item-nombre">${sanitizar(c.nombre)}</div>
                <div class="inv-item-precio">$${parseFloat(c.precio||0).toFixed(2)} · ${disponible} disp. de ${parseInt(c.cantidad||0)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                <button class="btn btn-verde" style="padding:5px 8px;font-size:11px;" title="Úsalo cuando la pieza YA se vendió y ya se liquidó (ej. quedó mal cerrada por el bug del corte) — cierra el item SIN devolver stock a bodega, a diferencia de 🗑️"
                    onclick="cerrarItemYaVendido(${jsArg(c.id)},${jsArg(c.nombre)})">✅ Ya vendida</button>
                <button class="btn btn-rojo" style="padding:5px 8px;font-size:11px;" title="La pieza vuelve físicamente a bodega de VEREX"
                    onclick="eliminarItemInventario(${jsArg(c.id)},${jsArg(c.nombre)})">🗑️ Devolver</button>
            </div>
        </div>`;
    }).join('');
}

// Piezas cerradas ("vendido") de este vendedor — normalmente correcto (así
// quedan tras un corte que las liquida), pero también es donde termina
// escondida una venta cerrada por error con "Ya vendida" antes de que
// existiera la pregunta NUEVA/LIQUIDADA: la venta ya cuenta en su historial,
// pero el registro no vuelve a sumar en su stock/comisión en vivo hasta el
// próximo corte. Oculto por defecto (no es información que se necesite ver
// seguido) — "🔓 Reactivar" es una acción de admin que asume que sabés que
// esa venta NO se pagó todavía en ningún corte; si ya se pagó, no la toques.
let _cerradasVendidoVisible = false;
function toggleCerradasVendido() {
    _cerradasVendidoVisible = !_cerradasVendidoVisible;
    const wrap = document.getElementById("lista-cerradas-vendido");
    if (!wrap) return;
    wrap.style.display = _cerradasVendidoVisible ? "block" : "none";
    if (_cerradasVendidoVisible) renderCerradasVendido();
}
function renderCerradasVendido() {
    const wrap = document.getElementById("lista-cerradas-vendido");
    if (!wrap) return;
    const cerradas = consignacion.filter(c => c.vendedor === vendedorActual.codigo && c.estado === "vendido");
    if (!cerradas.length) {
        wrap.innerHTML = '<p style="color:var(--plateado);font-size:12px;">No hay piezas cerradas.</p>';
        return;
    }
    wrap.innerHTML = `<p style="font-size:11px;color:var(--plateado);margin-bottom:6px;">Reactivá solo si esa venta TODAVÍA no se pagó en ningún corte anterior — si ya se pagó, reactivarla la cuenta dos veces.</p>` +
        cerradas.map(c => `
            <div style="background:var(--gris2);border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                <div style="font-size:12px;"><strong>${sanitizar(c.codigo)}</strong> — ${sanitizar(c.nombre)}
                    <div style="font-size:10.5px;color:var(--plateado);">$${parseFloat(c.precio||0).toFixed(2)} · vendido ${c.vendido||0} de ${c.cantidad||0}</div>
                </div>
                <button onclick="reactivarConsignacion(${jsArg(c.id)})" style="padding:5px 10px;font-size:11px;background:#4a6fa5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;">🔓 Reactivar</button>
            </div>`).join('');
}
async function reactivarConsignacion(id) {
    if (!confirm("¿Reactivar este registro? Solo hacelo si estás seguro de que esta venta NO se le pagó ya al vendedor en un corte anterior — si ya se pagó, la comisión se contaría dos veces.")) return;
    const res = await apiPost({ accion: "REACTIVAR_CONSIGNACION", id });
    if (!res.ok) { toast("⚠️ " + (res.error||"No se pudo reactivar"), "#c0392b"); return; }
    const item = consignacion.find(c => String(c.id) === String(id));
    if (item) item.estado = "activo";
    renderPerfilStats();
    renderInventario();
    renderCerradasVendido();
    toast("✅ Reactivado — ya vuelve a contar en su stock/comisión en vivo");
}

function renderVentasPerfil() {
    const lista = document.getElementById("lista-ventas-perfil");
    if (!lista) return;
    const inv = consignacion.filter(c => c.vendedor === vendedorActual.codigo && (parseInt(c.vendido)||0) > 0);
    if (!inv.length) {
        lista.innerHTML = '<p style="color:var(--plateado);font-size:13px;">Sin ventas registradas aún.</p>';
        return;
    }
    const totalVendido  = inv.reduce((s,c) => s + (parseInt(c.vendido)||0), 0);
    const totalIngresos = inv.reduce((s,c) => s + (parseInt(c.vendido)||0) * parseFloat(c.precio||0), 0);
    lista.innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
            <div style="background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);border-radius:8px;padding:10px 16px;text-align:center;min-width:90px;">
                <div style="font-size:20px;font-weight:800;color:#2ecc71;">${totalVendido}</div>
                <div style="font-size:11px;color:var(--plateado);">unidades</div>
            </div>
            <div style="background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:8px;padding:10px 16px;text-align:center;min-width:90px;">
                <div style="font-size:20px;font-weight:800;color:var(--dorado);">$${totalIngresos.toFixed(2)}</div>
                <div style="font-size:11px;color:var(--plateado);">ingresos</div>
            </div>
        </div>
        ${inv.map(c => {
            const vendido = parseInt(c.vendido)||0;
            const ingreso = vendido * parseFloat(c.precio||0);
            const foto    = c.foto
                ? `<img src="${sanitizar(ikFoto(c.foto,200))}" onerror="this.style.display='none'" style="width:44px;height:44px;object-fit:cover;border-radius:7px;flex-shrink:0;">`
                : `<div style="width:44px;height:44px;background:var(--gris2);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">💍</div>`;
            return `<div class="inv-item">
                ${foto}
                <div class="inv-item-info">
                    <div class="inv-item-codigo">${sanitizar(c.codigo)}</div>
                    <div class="inv-item-nombre">${sanitizar(c.nombre)}</div>
                    <div class="inv-item-precio">$${parseFloat(c.precio||0).toFixed(2)} × ${vendido} vendido(s) = <strong style="color:#2ecc71;">$${ingreso.toFixed(2)}</strong></div>
                </div>
            </div>`;
        }).join('')}`;
}

function abrirDevolucion() {
    if (!vendedorActual) return;
    const disponibles = consignacion.filter(c =>
        c.vendedor === vendedorActual.codigo &&
        c.estado === "activo" &&
        (parseInt(c.cantidad||0) - parseInt(c.vendido||0)) > 0
    );
    if (!disponibles.length) { toast("No hay productos disponibles para devolver"); return; }
    document.getElementById("lista-devolucion").innerHTML = disponibles.map(c => {
        const disp = parseInt(c.cantidad||0) - parseInt(c.vendido||0);
        const foto = c.foto
            ? `<img src="${sanitizar(ikFoto(c.foto,200))}" onerror="this.style.display='none'" style="width:44px;height:44px;object-fit:cover;border-radius:7px;flex-shrink:0;">`
            : `<div style="width:44px;height:44px;background:var(--gris2);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">💍</div>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--gris2);border-radius:10px;margin-bottom:8px;">
            <input type="checkbox" id="dev-check-${sanitizar(c.id)}" checked style="width:18px;height:18px;accent-color:var(--dorado);flex-shrink:0;" onchange="toggleDevRow('${sanitizar(c.id)}')">
            ${foto}
            <div style="flex:1;min-width:0;">
                <div style="font-size:11px;color:var(--dorado);font-weight:700;">${sanitizar(c.codigo)}</div>
                <div style="font-size:13px;font-weight:600;">${sanitizar(c.nombre)}</div>
                <div style="font-size:11px;color:var(--plateado);">Disponibles: ${disp}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                <button onclick="cambiarCantDev('${sanitizar(c.id)}',-1,${disp})" style="width:26px;height:26px;border-radius:50%;border:none;background:var(--gris);color:var(--blanco);font-size:16px;cursor:pointer;">-</button>
                <span id="dev-qty-${sanitizar(c.id)}" style="font-size:15px;font-weight:700;min-width:20px;text-align:center;">${disp}</span>
                <button onclick="cambiarCantDev('${sanitizar(c.id)}',1,${disp})" style="width:26px;height:26px;border-radius:50%;border:none;background:var(--gris);color:var(--blanco);font-size:16px;cursor:pointer;">+</button>
            </div>
        </div>`;
    }).join('');
    window._devItems = disponibles.map(c => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, max: parseInt(c.cantidad||0) - parseInt(c.vendido||0) }));
    // Mientras no se use el escáner, el modal arranca con todo marcado para
    // devolver (comportamiento de siempre: devolver todo de un tin). En
    // cuanto se escanea la primera pieza, _onScanDevolucion() pone todo en 0
    // y pasa a modo "conteo por escaneo" — ver ese comentario para el porqué.
    window._devEscaneoIniciado = false;
    // Identificador único de ESTA devolución: si se reenvía (doble clic, corte de red), el servidor no la aplica dos veces.
    window._devIdActual = "DEV_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    renderResumenDevolucion();
    abrirModal("modal-devolucion");
}

function toggleDevRow(id) {
    const check = document.getElementById("dev-check-" + id);
    const qty   = document.getElementById("dev-qty-" + id);
    const item  = window._devItems?.find(i => sanitizar(i.id) === id);
    if (check && qty && item) qty.textContent = check.checked ? item.max : "0";
    renderResumenDevolucion();
}

function cambiarCantDev(id, delta, max) {
    const qty   = document.getElementById("dev-qty-" + id);
    const check = document.getElementById("dev-check-" + id);
    if (!qty) return;
    const nueva = Math.min(max, Math.max(0, (parseInt(qty.textContent)||0) + delta));
    qty.textContent = nueva;
    if (check) check.checked = nueva > 0;
    renderResumenDevolucion();
}

// Resumen en vivo de la devolución: compara lo pendiente (entregado - vendido,
// osea lo que aún no está ni vendido ni devuelto) contra lo que se lleva
// marcado/escaneado para devolver ahora. Si no coincide, avisa cuáles
// productos quedan con piezas sin explicar — sin bloquear el "Confirmar
// Devolución", solo como advertencia (puede ser una pieza perdida/dañada real).
function renderResumenDevolucion() {
    const box = document.getElementById("resumen-devolucion");
    if (!box || !window._devItems) return;
    let pendiente = 0, aDevolver = 0;
    const faltantes = [];
    window._devItems.forEach(item => {
        const qty = parseInt(document.getElementById("dev-qty-" + sanitizar(item.id))?.textContent) || 0;
        pendiente += item.max;
        aDevolver += qty;
        if (qty < item.max) faltantes.push({ codigo: item.codigo, nombre: item.nombre, faltan: item.max - qty });
    });
    const faltanteTotal = pendiente - aDevolver;
    box.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="stat-box"><div class="stat-num">${pendiente}</div><div class="stat-label">Pendiente (sin vender)</div></div>
            <div class="stat-box"><div class="stat-num">${aDevolver}</div><div class="stat-label">A devolver ahora</div></div>
        </div>
        ${faltanteTotal > 0 ? `
        <div style="margin-top:8px;padding:10px 12px;background:rgba(230,126,34,0.12);border:1px solid #e67e22;border-radius:10px;">
            <div style="color:#e67e22;font-weight:700;font-size:12px;margin-bottom:4px;">⚠️ Faltan ${faltanteTotal} pieza(s) sin explicar</div>
            <div style="font-size:11px;color:var(--plateado);line-height:1.5;">
                ${faltantes.map(f => sanitizar(f.codigo) + " — " + sanitizar(f.nombre) + " (faltan " + f.faltan + ")").join("<br>")}
            </div>
        </div>` : `
        <div style="margin-top:8px;padding:8px 12px;background:rgba(46,204,113,0.1);border:1px solid #27ae60;border-radius:10px;color:#27ae60;font-size:12px;font-weight:700;">✅ Todo cuadra con lo pendiente</div>`}
    `;
}

// Escaneo de piezas devueltas físicamente — el vendedor entrega los productos
// y se escanean uno a uno para que la cantidad no dependa de contarlos a mano.
function _onScanDevolucion(codRaw) {
    const cod = String(codRaw || "").trim().toUpperCase();
    if (!window._devItems || !window._devItems.length) return;
    if (!window._devEscaneoIniciado) {
        window._devItems.forEach(item => {
            const qty = document.getElementById("dev-qty-" + sanitizar(item.id));
            const chk = document.getElementById("dev-check-" + sanitizar(item.id));
            if (qty) qty.textContent = "0";
            if (chk) chk.checked = false;
        });
        window._devEscaneoIniciado = true;
    }
    const item = window._devItems.find(i => String(i.codigo).toUpperCase() === cod);
    if (!item) {
        toast("⚠️ \"" + cod + "\" no está pendiente de devolver de este vendedor", "#f97316");
        return;
    }
    const idSan = sanitizar(item.id);
    const actual = parseInt(document.getElementById("dev-qty-" + idSan)?.textContent) || 0;
    if (actual >= item.max) {
        toast("⚠️ " + item.codigo + " ya tiene las " + item.max + " pieza(s) disponibles registradas", "#f97316");
        return;
    }
    cambiarCantDev(idSan, 1, item.max);
    mostrarConfirmacionEscaneo(null, item.nombre, item.codigo + " · devuelto " + (actual + 1) + "/" + item.max);
}

async function confirmarDevolucion() {
    const items = (window._devItems || []).map(item => {
        const qty = parseInt(document.getElementById("dev-qty-" + sanitizar(item.id))?.textContent) || 0;
        return { ...item, cantidad: qty };
    }).filter(i => i.cantidad > 0);
    if (!items.length) { toast("Selecciona al menos un producto"); return; }
    const btn = document.querySelector("#modal-devolucion .btn-dorado");
    btn.textContent = "Guardando..."; btn.disabled = true;
    try {
        const resp = await apiPost({ accion: "REGISTRAR_DEVOLUCION", vendedor: vendedorActual.codigo, items, devId: window._devIdActual });
        if (!resp.ok) throw new Error(resp.error || "Error del servidor");

        // Pausar auto-sync 60s para que no revierta los cambios locales
        _pausarSyncHasta = Date.now() + 60000;

        // Lo que el SERVIDOR aplicó de verdad (puede ser menos que lo pedido si alguna pieza ya estaba devuelta).
        // Con un Worker antiguo que no lo manda, se usa lo pedido.
        const aplicados = Array.isArray(resp.registro) ? resp.registro : items;

        // Actualizar consignacion local
        aplicados.forEach(item => {
            const c = consignacion.find(c => String(c.id) === String(item.id));
            if (c) {
                c.cantidad = Math.max(parseInt(c.vendido||0), parseInt(c.cantidad||0) - item.cantidad);
                if (parseInt(c.cantidad) <= parseInt(c.vendido||0)) c.estado = "devuelto";
            }
        });

        // Actualizar stockData local (stock_bodega + stock_consignacion): la bodega toma el valor exacto del servidor
        const bodegaServidor = new Map((resp.devuelto || []).map(x => [String(x.codigo), x]));
        const yaAplicado = new Set();
        aplicados.forEach(item => {
            const s = stockData.find(s => s.codigo === item.codigo);
            if (!s) return;
            const srv = bodegaServidor.get(String(item.codigo));
            if (srv) {
                if (yaAplicado.has(item.codigo)) return;              // varias líneas del mismo código: el servidor ya las sumó
                yaAplicado.add(item.codigo);
                s.stock_bodega       = srv.stock_bodega;
                s.stock_consignacion = Math.max(0, (parseInt(s.stock_consignacion) || 0) - srv.cantidad);
            } else {
                s.stock_bodega       = (parseInt(s.stock_bodega)       || 0) + item.cantidad;
                s.stock_consignacion = Math.max(0, (parseInt(s.stock_consignacion) || 0) - item.cantidad);
            }
        });

        cerrarModal("modal-devolucion");
        renderPerfilStats();
        renderInventario();
        renderVentasPerfil();
        renderStock(stockData);
        cargarDevolucionesPerfil(); // Refrescar historial de devoluciones
        window._devIdActual = null;
        const advDev = resp.advertencias || [];
        if (advDev.length) toast("✅ Devolución registrada — ⚠️ " + advDev.join(" · "), "#e67e22", 10000);
        else toast("✅ Devolución registrada — stock devuelto a bodega");
    } catch(e) {
        toast("⚠️ " + (e.message || "Error al registrar devolución"));
    }
    btn.textContent = "✅ Confirmar Devolución"; btn.disabled = false;
}

function volverVendedores() {
    document.getElementById("pantalla-perfil").style.display = "none";
    document.getElementById("pantalla-vendedores").style.display = "block";
    vendedorActual = null;
}

function volverPerfil() {
    document.getElementById("pantalla-entrega").style.display = "none";
    document.getElementById("pantalla-perfil").style.display = "block";
    document.getElementById("carrito-entrega").classList.remove("visible");
    carritoEntrega = {};
}

let _esVentaDirectaAfiliado = false;

function abrirVentaAfiliado() {
    _esVentaDirectaAfiliado = true;
    abrirEntrega();
}
