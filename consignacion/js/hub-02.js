

function abrirModalVendedor() {
    document.getElementById("v-nombre").value = "";
    document.getElementById("v-tel").value = "";
    document.getElementById("v-dui").value = "";
    document.getElementById("v-comision-fija").value = "";
    document.getElementById("v-pin").value = "";
    document.getElementById("v-notas").value = "";
    document.getElementById("v-recibe-fisico").checked = false;
    selTipoVendedor("consignacion");
    abrirModal("modal-vendedor");
}

async function guardarVendedor() {
    const nombre = document.getElementById("v-nombre").value.trim();
    const tel    = document.getElementById("v-tel").value.trim();
    const dui    = document.getElementById("v-dui").value.trim();
    if (!nombre || !tel) { toast("⚠️ Completa todos los campos"); return; }
    // Código: iniciales del nombre + YYMM (ej: EN-2501)
    const iniciales = nombre.split(" ").map(p => p[0]).filter(Boolean).slice(0,2).join("").toUpperCase();
    const ahora = new Date();
    const yymm  = String(ahora.getFullYear()).slice(2) + String(ahora.getMonth()+1).padStart(2,"0");
    // Si ya existe ese código, agregar secuencial
    let base = iniciales + "-" + yymm;
    let codigo = base;
    let seq = 2;
    while (vendedores.some(v => v.codigo === codigo)) { codigo = base + "-" + seq++; }
    const comisionFijaRaw = document.getElementById("v-comision-fija").value.trim();
    const comisionFija    = comisionFijaRaw !== "" ? Math.min(100, Math.max(0, parseFloat(comisionFijaRaw))) : null;
    const notas = document.getElementById("v-notas").value.trim();
    const pinRaw = document.getElementById("v-pin").value.trim();
    const recibeFisico = _tipoVendedorSel === "afiliado" && document.getElementById("v-recibe-fisico").checked;
    const v = {
        codigo, nombre, telefono: tel, tipo: _tipoVendedorSel,
        activo: true, fechaRegistro: ahora.toISOString(),
        ...(dui && { dui }),
        ...(comisionFija !== null && { comisionFija }),
        ...(notas && { notas }),
        ...(recibeFisico && { recibeFisico: true }),
        ...(pinRaw.length === 4 && { pin: pinRaw })
    };
    vendedores.push(v);
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: v });
    cerrarModal("modal-vendedor");
    renderVendedores();
    toast("✅ Vendedor registrado");
    // Firma digital del contrato (o "firmar después" para PDF con líneas en blanco)
    setTimeout(() => abrirFirmaContrato(v), 500);
}

function generarContratoPDF(vendedor) {
    const esAfiliado = vendedor.tipo === "afiliado" || vendedor.tipo === "hibrido";
    return esAfiliado ? generarContratoAfiliadoPDF(vendedor) : generarContratoConsignacionPDF(vendedor);
}

function generarContratoConsignacionPDF(vendedor) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const fecha = new Date().toLocaleDateString("es-SV", { year: "numeric", month: "long", day: "numeric" });
    const pageW = 210;
    const mL = 20, mR = 20;
    const textW = pageW - mL - mR;
    let y = 20;

    function checkPage(needed) {
        if (y + needed > 280) { doc.addPage(); y = 20; }
    }

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(201, 168, 76);
    doc.text("VEREX", pageW / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text("CONTRATO DE CONSIGNACIÓN", pageW / 2, y, { align: "center" }); y += 12;

    // Intro
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const intro = `Conste por el presente documento el contrato de consignación celebrado el ${fecha}, entre VEREX (El Consignante) y el vendedor identificado a continuación (El Consignatario).`;
    const introLines = doc.splitTextToSize(intro, textW);
    doc.text(introLines, mL, y); y += introLines.length * 5 + 6;

    // Datos vendedor
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(201, 168, 76);
    doc.text("DATOS DEL CONSIGNATARIO", mL, y); y += 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    [["Nombre:", vendedor.nombre], ["Teléfono:", vendedor.telefono], ...(vendedor.dui ? [["DUI:", vendedor.dui]] : []), ["Código:", vendedor.codigo], ["Fecha inicio:", fecha]].forEach(([label, val]) => {
        doc.setFont("helvetica", "bold"); doc.text(label, mL, y);
        doc.setFont("helvetica", "normal"); doc.text(val, mL + 35, y); y += 6;
    });
    y += 4;

    // Cláusulas
    const clausulas = [
        ["1. OBJETO", "El Consignante entrega joyería al Consignatario para su venta en consignación, conservando la propiedad de los bienes hasta su venta efectiva."],
        ["2. PLAZO", "El período de consignación será de 30 días calendario, al cabo de los cuales se realizará un corte de cuentas. Las piezas no vendidas podrán renovarse por acuerdo mutuo."],
        ["3. PRECIOS", "El Consignatario venderá las piezas al precio establecido por VEREX. No podrá modificar precios sin autorización escrita."],
        ["4. RESPONSABILIDAD", "El Consignatario es responsable de las piezas recibidas. En caso de pérdida, robo o daño, deberá cubrir el valor de las mismas al precio de costo."],
        ["5. DEVOLUCIONES", "Las piezas no vendidas deben devolverse en perfecto estado al momento del corte. El deterioro por mal manejo será responsabilidad del Consignatario."],
        ["6. PAGOS", "El Consignatario pagará a VEREX el monto correspondiente (precio de venta menos su comisión) en cada corte de cuentas."],
    ];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(201, 168, 76);
    doc.text("CLÁUSULAS DEL CONTRATO", mL, y); y += 6;

    clausulas.forEach(([titulo, texto]) => {
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(texto, textW);
        checkPage(5 + lines.length * 5 + 4);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(40, 40, 40);
        doc.text(titulo, mL, y); y += 5;
        doc.setFont("helvetica", "normal");
        doc.text(lines, mL, y); y += lines.length * 5 + 4;
    });

    // Tabla comisiones
    checkPage(45);
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(201, 168, 76);
    doc.text("TABLA DE COMISIONES", mL, y); y += 6;
    doc.setFillColor(30, 30, 30);
    doc.rect(mL, y, textW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text("Ventas del período", mL + 4, y + 5);
    doc.text("Comisión del vendedor", mL + 100, y + 5); y += 8;
    [["$0 — $199.99", "25%"], ["$200 — $399.99", "30%"], ["$400 o más", "35%"]].forEach(([rango, pct], i) => {
        doc.setFillColor(i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255);
        doc.rect(mL, y, textW, 7, 'F');
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "normal");
        doc.text(rango, mL + 4, y + 5);
        doc.setFont("helvetica", "bold");
        doc.text(pct, mL + 100, y + 5); y += 7;
    });

    // Firmas
    checkPage(45);
    y += 16;
    if (vendedor.firmaContrato) {
        try { doc.addImage(vendedor.firmaContrato, "PNG", mL, y - 14, 60, 16); } catch(_) {}
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.line(mL, y, mL + 70, y);
    doc.line(pageW - mR - 70, y, pageW - mR, y);
    y += 5;
    doc.text("Firma del Consignatario", mL, y);
    doc.text("Firma VEREX", pageW - mR - 70, y); y += 5;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(vendedor.nombre, mL, y);
    doc.text("Administrador", pageW - mR - 70, y); y += 5;
    if (vendedor.firmaContrato) {
        doc.setFontSize(7.5);
        doc.setTextColor(140, 140, 140);
        const fFirma = vendedor.firmaContratoFecha ? new Date(vendedor.firmaContratoFecha).toLocaleDateString("es-SV",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
        doc.text("Firmado digitalmente el " + fFirma, mL, y);
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text("VEREX Nexus • " + fecha, pageW / 2, Math.min(y + 12, 290), { align: "center" });

    doc.save("Contrato_" + vendedor.nombre.replace(/ /g, "_") + ".pdf");
    toast("📄 Contrato generado");
}

function generarContratoAfiliadoPDF(vendedor) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const fecha = new Date().toLocaleDateString("es-SV", { year: "numeric", month: "long", day: "numeric" });
    const pageW = 210;
    const mL = 20, mR = 20;
    const textW = pageW - mL - mR;
    let y = 20;

    const tieneComisionFija = vendedor.comisionFija !== undefined && vendedor.comisionFija !== null;

    function checkPage(needed) {
        if (y + needed > 280) { doc.addPage(); y = 20; }
    }

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(201, 168, 76);
    doc.text("VEREX", pageW / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text("CONTRATO DE AFILIADO", pageW / 2, y, { align: "center" }); y += 12;

    // Intro
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const intro = `Conste por el presente documento el acuerdo de afiliación celebrado el ${fecha}, entre VEREX y la persona identificada a continuación (El Afiliado), para la promoción y venta de productos VEREX a través de un catálogo digital personalizado.`;
    const introLines = doc.splitTextToSize(intro, textW);
    doc.text(introLines, mL, y); y += introLines.length * 5 + 6;

    // Datos afiliado
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(201, 168, 76);
    doc.text("DATOS DEL AFILIADO", mL, y); y += 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    [["Nombre:", vendedor.nombre], ["Teléfono:", vendedor.telefono], ...(vendedor.dui ? [["DUI:", vendedor.dui]] : []), ["Código:", vendedor.codigo], ["Fecha inicio:", fecha]].forEach(([label, val]) => {
        doc.setFont("helvetica", "bold"); doc.text(label, mL, y);
        doc.setFont("helvetica", "normal"); doc.text(val, mL + 35, y); y += 6;
    });
    y += 4;

    // Cláusulas — adaptadas al modelo de afiliado. Si recibeFisico está activo,
    // este afiliado SÍ recibe piezas físicas para entregar y asume la responsabilidad
    // correspondiente sobre esas piezas, igual que un vendedor de consignación.
    const recibeFisico = vendedor.recibeFisico === true;
    const clausulas = [
        ["1. OBJETO", recibeFisico
            ? "VEREX entrega al Afiliado un catálogo digital personalizado para que lo comparta con sus propios clientes y gestione la venta por su cuenta. Adicionalmente, VEREX podrá entregarle piezas físicas para que el Afiliado realice la entrega directa a sus clientes, conservando la propiedad de dichas piezas hasta su venta efectiva."
            : "VEREX entrega al Afiliado un catálogo digital personalizado para que lo comparta con sus propios clientes y gestione la venta por su cuenta. En ningún momento el Afiliado recibe mercancía física — el inventario permanece bajo custodia y propiedad de VEREX."],
        ["2. FUNCIONAMIENTO", recibeFisico
            ? "Cuando el Afiliado cierra una venta con un cliente, podrá entregarla directamente si ya tiene la pieza en su poder, o coordinar con VEREX la entrega. VEREX confirma cada venta al momento en que se le informa la entrega; solo hasta esa confirmación se genera la comisión correspondiente."
            : "Cuando el Afiliado cierra una venta con un cliente, debe coordinar con VEREX la entrega de la pieza. VEREX confirma la venta al momento de la entrega; solo hasta esa confirmación se genera la comisión correspondiente."],
        ["3. DATOS DEL CLIENTE", "El Afiliado se obliga a proporcionar los datos completos del cliente (nombre, dirección y teléfono) para cada venta, a través de los medios que VEREX disponga para ello, como condición previa a la confirmación de la venta y a la liquidación de la comisión correspondiente."],
        ["4. PRECIOS", "El Afiliado ofrecerá las piezas al precio establecido por VEREX en el catálogo. No podrá modificar precios sin autorización escrita."],
        recibeFisico
            ? ["5. RESPONSABILIDAD POR PIEZAS ENTREGADAS", "El Afiliado es responsable de las piezas físicas que reciba de VEREX. En caso de pérdida, robo o daño, deberá pagar a VEREX el precio de venta de la pieza menos la comisión que le habría correspondido — el mismo monto que VEREX habría recibido si la pieza se hubiera vendido normalmente. Las piezas no vendidas deben devolverse en perfecto estado según lo acordado con VEREX."]
            : ["5. SIN RESPONSABILIDAD POR INVENTARIO", "Al no recibir mercancía física, el Afiliado no asume responsabilidad por pérdida, robo o daño de piezas — dicha responsabilidad es exclusiva de VEREX hasta el momento de la entrega al cliente final."],
        ["6. COMISIÓN", tieneComisionFija
            ? `El Afiliado recibirá una comisión fija del ${vendedor.comisionFija}% sobre cada venta confirmada por VEREX, independientemente del monto acumulado en el período.`
            : "El Afiliado recibirá una comisión por tramos según el monto total de ventas confirmadas por VEREX en el período, conforme a la tabla incluida en este contrato."],
        ["7. PAGOS", "La comisión se liquida en cada corte de cuentas, únicamente sobre las ventas que VEREX haya confirmado como entregadas."],
    ];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(201, 168, 76);
    doc.text("CLÁUSULAS DEL CONTRATO", mL, y); y += 6;

    clausulas.forEach(([titulo, texto]) => {
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(texto, textW);
        checkPage(5 + lines.length * 5 + 4);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(40, 40, 40);
        doc.text(titulo, mL, y); y += 5;
        doc.setFont("helvetica", "normal");
        doc.text(lines, mL, y); y += lines.length * 5 + 4;
    });

    // Tabla / condición de comisión
    checkPage(45);
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(201, 168, 76);
    doc.text("COMISIÓN DEL AFILIADO", mL, y); y += 6;

    if (tieneComisionFija) {
        doc.setFillColor(30, 30, 30);
        doc.rect(mL, y, textW, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.text("Comisión fija acordada", mL + 4, y + 5); y += 8;
        doc.setFillColor(248, 248, 248);
        doc.rect(mL, y, textW, 7, 'F');
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "bold");
        doc.text(vendedor.comisionFija + "% sobre cada venta confirmada", mL + 4, y + 5); y += 7;
    } else {
        doc.setFillColor(30, 30, 30);
        doc.rect(mL, y, textW, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.text("Ventas confirmadas del período", mL + 4, y + 5);
        doc.text("Comisión del afiliado", mL + 100, y + 5); y += 8;
        RANGOS_COMISION_AFILIADO.forEach((r, i) => {
            const rango = r.max >= 99999 ? `$${r.min} o más` : `$${r.min} — $${r.max}`;
            doc.setFillColor(i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255);
            doc.rect(mL, y, textW, 7, 'F');
            doc.setTextColor(40, 40, 40);
            doc.setFont("helvetica", "normal");
            doc.text(rango, mL + 4, y + 5);
            doc.setFont("helvetica", "bold");
            doc.text(r.pct + "%", mL + 100, y + 5); y += 7;
        });
    }

    // Firmas
    checkPage(45);
    y += 16;
    if (vendedor.firmaContrato) {
        try { doc.addImage(vendedor.firmaContrato, "PNG", mL, y - 14, 60, 16); } catch(_) {}
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.line(mL, y, mL + 70, y);
    doc.line(pageW - mR - 70, y, pageW - mR, y);
    y += 5;
    doc.text("Firma del Afiliado", mL, y);
    doc.text("Firma VEREX", pageW - mR - 70, y); y += 5;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(vendedor.nombre, mL, y);
    doc.text("Administrador", pageW - mR - 70, y); y += 5;
    if (vendedor.firmaContrato) {
        doc.setFontSize(7.5);
        doc.setTextColor(140, 140, 140);
        const fFirma = vendedor.firmaContratoFecha ? new Date(vendedor.firmaContratoFecha).toLocaleDateString("es-SV",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
        doc.text("Firmado digitalmente el " + fFirma, mL, y);
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text("VEREX — Programa de Afiliados • " + fecha, pageW / 2, Math.min(y + 12, 290), { align: "center" });

    doc.save("Contrato_Afiliado_" + vendedor.nombre.replace(/ /g, "_") + ".pdf");
    toast("📄 Contrato de afiliado generado");
}

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
    [btnEntrega, btnLinkInv, btnHistEnt, btnDevol].forEach(b => { if (b) b.style.display = ocultarFisico ? "none" : ""; });
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
    const btnVerCatalogo = document.getElementById("btn-menu-ver-catalogo");
    if (btnVerCatalogo) btnVerCatalogo.style.display = esAfil ? "" : "none";

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

async function abrirEntrega() {
    carritoEntrega = {};
    _scansFallidosSesion = [];
    const wrapFallidos = document.getElementById("escaneos-fallidos-wrap");
    if (wrapFallidos) wrapFallidos.style.display = "none";
    document.getElementById("pantalla-perfil").style.display = "none";
    document.getElementById("pantalla-entrega").style.display = "block";
    document.getElementById("bus-entrega").value = "";
    document.getElementById("grid-entrega").innerHTML = '<p style="color:var(--plateado);font-size:13px;padding:10px;">⏳ Cargando inventario...</p>';

    const titulo = document.getElementById("entrega-titulo");
    const btnMano  = document.getElementById("btn-entrega-en-mano");
    const btnMens  = document.getElementById("btn-entrega-mensajeria");
    const btnVenta = document.getElementById("btn-venta-afiliado");
    const btnBorr  = document.getElementById("btn-guardar-borrador");
    const wrapFechaVA = document.getElementById("wrap-fecha-venta-afiliado");
    const inpFechaVA  = document.getElementById("fecha-venta-afiliado");
    if (_esVentaDirectaAfiliado) {
        if (titulo) titulo.textContent = "💰 Registrar Venta de Afiliado";
        if (btnMano) btnMano.style.display = "none";
        if (btnMens) btnMens.style.display = "none";
        if (btnBorr) btnBorr.style.display = "none";
        if (btnVenta) btnVenta.style.display = "inline-flex";
        if (wrapFechaVA) wrapFechaVA.style.display = "flex";
        if (inpFechaVA) { inpFechaVA.max = new Date().toISOString().slice(0,10); inpFechaVA.value = inpFechaVA.max; }
    } else {
        if (titulo) titulo.textContent = "📦 Nueva Entrega";
        if (btnMano) btnMano.style.display = "";
        if (btnMens) btnMens.style.display = "";
        if (btnBorr) btnBorr.style.display = "";
        if (btnVenta) btnVenta.style.display = "none";
        if (wrapFechaVA) wrapFechaVA.style.display = "none";
    }

    // Refrescar SIEMPRE el stock al abrir — otras pantallas (Etiquetas, Stock)
    // pueden haber sobrescrito stockData/productosDisponibles con datos viejos,
    // y aquí necesitamos ver el inventario de bodega más actual posible.
    try {
        const res = await apiPost({ accion: "STOCK_GET_ALL" });
        stockData = res.stock || [];
    } catch(e) { if (!stockData.length) stockData = []; }

    // Construir lista a mostrar usando stockData (puede tener múltiples entradas por código/talla)
    // Solo mostrar variantes con stock en bodega > 0
    let prodsFiltrados;
    if (stockData.length > 0) {
        prodsFiltrados = stockData
            .filter(s => (parseInt(s.stock_bodega) || 0) > 0)
            .map(s => {
                // Buscar en productosDisponibles por código Y nombre (para diferenciar tallas)
                const prod = productosDisponibles.find(p =>
                    p.codigo === s.codigo && p.nombre === s.nombre
                ) || productosDisponibles.find(p => p.codigo === s.codigo);
                const base = prod || {};
                return {
                    codigo:      s.codigo || base.codigo || "",
                    nombre:      s.nombre || base.nombre || "",
                    precio:      s.precio || base.precio || base.precioNum || 0,
                    precioNum:   s.precio || base.precio || base.precioNum || 0,
                    img:         s.foto   || base.img    || "",
                    categoria:   s.categoria || base.categoria || "",
                    descripcion: s.descripcion || base.descripcion || "",
                    estado:      s.estado || "bodega",
                    stock_bodega: parseInt(s.stock_bodega) || 0,
                    _fromStock: true
                };
            });
    } else {
        // Si aún no hay stockData, usar productosDisponibles
        prodsFiltrados = productosDisponibles;
    }

    // Mapa COMPLETO e inmutable durante esta sesión de entrega — usado por el
    // escaneo (físico o QR). A diferencia de mapaProductos (que renderGridEntrega
    // reconstruye SOLO con lo visible tras cada filtro de búsqueda, letra por
    // letra mientras el scanner "escribe"), este nunca se reduce, así el
    // producto recién escaneado siempre se encuentra aunque el buscador esté
    // mostrando otra cosa en ese instante.
    mapaProductosCompleto = {};
    const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
    [...prodsFiltrados, ...extras].forEach(p => {
        if (!mapaProductosCompleto[p.codigo]) mapaProductosCompleto[p.codigo] = p;
    });

    renderGridEntrega(prodsFiltrados);
}

let mapaProductos = {};
let mapaProductosCompleto = {};

// ── HELPERS DE CÓDIGO (SOLUCIÓN CORRECTA) ────────────────────────────
// El código COMPLETO es único por variante: "AN-021-T10", "AN-021-T12"
// El código BASE agrupa variantes:           "AN-021"
// La talla se extrae del CÓDIGO, no del nombre → no depende de convenciones de texto

// "AN021T10" → "AN021"   |  "CO005" → "CO005"
function getCodigoBase(codigo) {
    return (codigo || "").replace(/[DCU]?T\d+(\.\d+)?$/i, "").trim();
}

// "AN021T10" → "10"   |  "CO005" → null
function getTallaFromCodigo(codigo) {
    const m = (codigo || "").match(/T(\d+)$/i);
    return m ? m[1] : null;
}

// ID seguro para atributos HTML
function safeId(str) { return (str || "").replace(/[^a-zA-Z0-9]/g, '_'); }

function renderGridEntrega(prods) {
    const grid = document.getElementById("grid-entrega");
    const extras = safeParseJSON(localStorage.getItem("vx_prod_extras"), []);
    const todos  = [...prods, ...extras];

    // mapaProductos: clave = código ÚNICO del producto (estable, no cambia al filtrar)
    // prods (stockData) tienen prioridad sobre extras (localStorage) para conservar stock_bodega
    mapaProductos = {};
    todos.forEach(p => {
        if (!mapaProductos[p.codigo]) {
            mapaProductos[p.codigo] = p;
        } else {
            mapaProductos[p.codigo] = { ...p, stock_bodega: mapaProductos[p.codigo].stock_bodega ?? p.stock_bodega };
        }
    });

    // Agrupar por código BASE → una tarjeta por producto físico
    // "AN-021-T10", "AN-021-T12" → grupo "AN-021"
    // "CO-005" → grupo "CO-005"
    const grupos = {};
    const ordenGrupos = [];
    todos.forEach(p => {
        const base = getCodigoBase(p.codigo);
        if (!grupos[base]) { grupos[base] = []; ordenGrupos.push(base); }
        if (!grupos[base].some(x => x.codigo === p.codigo)) grupos[base].push(p);
    });

    grid.innerHTML = ordenGrupos.map(codigoBase => {
        const items = grupos[codigoBase];
        const ref   = items[0]; // referencia para imagen, precio, categoría del grupo
        // Nombre sin talla: preferir campo nombre_base si existe, sino limpiar el string
        const baseName = ref.nombre_base || (ref.nombre || "").replace(/-T\d+$/i, "").replace(/ T\d+$/i, "").trim() || ref.nombre;

        // Stock total en bodega de todas las variantes
        const totalBodega = items.reduce((s, p) => s + (parseInt(p.stock_bodega) || 0), 0);

        // Ocultar productos sin stock en bodega (no se pueden entregar)
        if (totalBodega === 0) return '';
        // Piezas totales en el carrito de este producto
        const totalQtyCarrito = items.reduce((s, p) => s + (carritoEntrega[p.codigo]?.qty || 0), 0);
        // Piezas en consignación activa (buscar por código base para abarcar todas las tallas)
        const enConsig = consignacion
            .filter(c => getCodigoBase(c.codigo) === codigoBase && c.estado === "activo")
            .reduce((s, c) => s + Math.max(0, parseInt(c.cantidad||0) - parseInt(c.vendido||0)), 0);

        // Badges
        const estadoBadge = totalBodega > 0
            ? `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:3px;background:rgba(39,174,96,0.18);border:1px solid rgba(39,174,96,0.5);border-radius:20px;padding:2px 7px;font-size:10px;color:#2ecc71;font-weight:600;">✅ Bodega: ${totalBodega}</div>`
            : `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:3px;background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.4);border-radius:20px;padding:2px 7px;font-size:10px;color:#e74c3c;font-weight:600;">❌ Sin stock</div>`;
        const consigBadge = enConsig > 0
            ? `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:2px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.4);border-radius:20px;padding:2px 7px;font-size:10px;color:var(--dorado);font-weight:600;">📦 Consig: ${enConsig}</div>`
            : '';

        // Piezas de este producto YA guardadas en borrador para el vendedor actual
        // (aún no entregadas físicamente ni visibles en su link) — avisa para no duplicar.
        const enBorradorVendedor = vendedorActual ? consignacion
            .filter(c => getCodigoBase(c.codigo) === codigoBase && c.estado === "borrador" && c.vendedor === vendedorActual.codigo)
            .reduce((s, c) => s + (parseInt(c.cantidad) || 0), 0) : 0;
        const borradorBadge = enBorradorVendedor > 0
            ? `<div style="display:inline-flex;align-items:center;gap:3px;margin-top:2px;background:rgba(74,111,165,0.18);border:1px solid rgba(74,111,165,0.5);border-radius:20px;padding:2px 7px;font-size:10px;color:#8ab4f0;font-weight:600;">📝 Ya en borrador: ${enBorradorVendedor}</div>`
            : '';

        const cardId = "pc-group-" + safeId(codigoBase);
        const menuId = "pmenu-" + safeId(codigoBase);

        // ¿Tiene variantes por talla? → alguna variante tiene "-T{N}" en el código
        const esTallaProducto = items.some(p => getTallaFromCodigo(p.codigo) !== null);

        let controlSection;
        if (esTallaProducto) {
            // Ordenar tallas numéricamente
            const itemsOrdenados = [...items].sort((a, b) => {
                const ta = parseInt(getTallaFromCodigo(a.codigo) || "0");
                const tb = parseInt(getTallaFromCodigo(b.codigo) || "0");
                return ta - tb;
            });
            const pills = itemsOrdenados.map(p => {
                const talla    = getTallaFromCodigo(p.codigo); // viene del código, no del nombre
                const qty      = carritoEntrega[p.codigo]?.qty || 0;
                const bodega   = parseInt(p.stock_bodega) || 0;
                const isSel    = qty > 0;
                const domId    = safeId(p.codigo);
                return `<div id="pill-${domId}" class="talla-pill" style="display:flex;flex-direction:column;align-items:center;gap:2px;
                        background:${isSel ? 'rgba(201,168,76,0.18)' : 'rgba(0,0,0,0.25)'};
                        border:1px solid ${isSel ? 'var(--dorado)' : 'var(--borde)'};
                        border-radius:8px;padding:5px 3px;min-width:48px;transition:all 0.15s;">
                    <div style="font-size:11px;font-weight:700;color:${isSel ? 'var(--dorado)' : 'var(--blanco)'};">T${talla}</div>
                    <div style="font-size:9px;color:${bodega > 0 ? '#2ecc71' : '#e74c3c'};">×${bodega}</div>
                    <div style="display:flex;align-items:center;gap:2px;margin-top:1px;">
                        <button class="qty-btn talla-pill-btn" style="width:20px;height:20px;font-size:13px;line-height:1;" onclick="cambiarQtyEntrega('${p.codigo}',-1)">−</button>
                        <span id="qty-${domId}" style="min-width:14px;text-align:center;font-size:11px;font-weight:700;">${qty}</span>
                        <button class="qty-btn talla-pill-btn" style="width:20px;height:20px;font-size:13px;line-height:1;" onclick="cambiarQtyEntrega('${p.codigo}',1)">+</button>
                    </div>
                </div>`;
            }).join('');
            controlSection = `<div style="display:flex;flex-wrap:wrap;gap:5px;padding:8px 6px;border-top:1px solid var(--borde);justify-content:center;">${pills}</div>`;
        } else {
            // Sin tallas → control simple
            const qty   = carritoEntrega[ref.codigo]?.qty || 0;
            const domId = safeId(ref.codigo);
            controlSection = `<div class="prod-card-qty">
                <button class="qty-btn" onclick="cambiarQtyEntrega('${ref.codigo}',-1)">−</button>
                <span class="qty-num" id="qty-${domId}">${qty}</span>
                <button class="qty-btn" onclick="cambiarQtyEntrega('${ref.codigo}',1)">+</button>
            </div>`;
        }

        return `<div class="prod-card ${totalQtyCarrito > 0 ? 'seleccionado' : ''}" id="${cardId}" style="position:relative;">
            <button class="menu-punto-btn" onclick="event.stopPropagation();toggleMenuProducto('${menuId}')"
                style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:24px;height:24px;font-size:13px;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center;">⋯</button>
            <div id="${menuId}" style="display:none;position:absolute;top:32px;right:6px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;z-index:10;min-width:130px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
                <button onclick="event.stopPropagation();verProducto('${ref.codigo}')"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:var(--blanco);font-size:13px;cursor:pointer;text-align:left;border-bottom:1px solid var(--borde);">✏️ Ver / Editar</button>
                <button onclick="event.stopPropagation();eliminarProductoCatalogo('${ref.codigo}')"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:#e74c3c;font-size:13px;cursor:pointer;text-align:left;">🗑️ Eliminar</button>
            </div>
            <img src="${ikFoto(ref.img, 400) || ''}" onerror="this.style.display='none'" onclick="verProducto('${ref.codigo}')" style="cursor:pointer;">
            <div class="prod-card-info" onclick="verProducto('${ref.codigo}')" style="cursor:pointer;">
                <div class="prod-card-codigo">${sanitizar(codigoBase)}</div>
                <div class="prod-card-nombre">${sanitizar(baseName)}</div>
                <div class="prod-card-precio">$${parseFloat(ref.precio||ref.precioNum||0).toFixed(2)}</div>
                ${estadoBadge}${consigBadge}${borradorBadge}
            </div>
            ${controlSection}
        </div>`;
    }).join('');
}

function cambiarQtyEntrega(codigo, delta) {
    // Corrección: clave = código único (estable, no cambia al filtrar ni reordenar).
    // Si el buscador está filtrado (p.ej. a media escritura de un scanner), el
    // producto puede no estar en mapaProductos (vista actual) pero sí en
    // mapaProductosCompleto (inventario completo de esta sesión de entrega).
    const prod = mapaProductos[codigo] || mapaProductosCompleto[codigo];
    if (!prod) return;
    if (!mapaProductos[codigo]) mapaProductos[codigo] = prod;
    if (!carritoEntrega[codigo]) carritoEntrega[codigo] = { item: prod, qty: 0 };
    const maxStock = !isNaN(parseInt(prod.stock_bodega)) ? parseInt(prod.stock_bodega) : 0;
    const newQty   = carritoEntrega[codigo].qty + delta;
    if (delta > 0 && newQty > maxStock) {
        toast("⚠️ No hay más stock en bodega (" + maxStock + " disponible" + (maxStock !== 1 ? "s" : "") + ")");
        return;
    }
    carritoEntrega[codigo].qty = Math.max(0, newQty);
    if (carritoEntrega[codigo].qty === 0) delete carritoEntrega[codigo];
    const nuevoQty = carritoEntrega[codigo]?.qty || 0;
    const domId    = safeId(codigo);

    // Actualizar span de cantidad
    const el = document.getElementById("qty-" + domId);
    if (el) el.textContent = nuevoQty;

    // Actualizar estilo de píldora de talla
    const pill = document.getElementById("pill-" + domId);
    if (pill) {
        const isNow = nuevoQty > 0;
        pill.style.background  = isNow ? 'rgba(201,168,76,0.18)' : 'rgba(0,0,0,0.25)';
        pill.style.borderColor = isNow ? 'var(--dorado)' : 'var(--borde)';
        const label = pill.querySelector('div:first-child');
        if (label) label.style.color = isNow ? 'var(--dorado)' : 'var(--blanco)';
    }

    // Actualizar borde de la tarjeta agrupada
    const codigoBase = getCodigoBase(codigo);
    const groupCard  = document.getElementById("pc-group-" + safeId(codigoBase));
    if (groupCard) {
        const anySelected = Object.keys(carritoEntrega).some(k =>
            getCodigoBase(k) === codigoBase && (carritoEntrega[k]?.qty || 0) > 0
        );
        groupCard.classList.toggle("seleccionado", anySelected);
    }

    actualizarCarritoEntrega();
}

function actualizarCarritoEntrega() {
    const items = Object.entries(carritoEntrega).filter(([, e]) => e.qty > 0);
    // Total de piezas físicas
    const totalPiezas = items.reduce((s, [, e]) => s + e.qty, 0);
    // Valor total
    const valor = items.reduce((s, [, e]) => s + e.qty * parseFloat(e.item.precio || e.item.precioNum || 0), 0);
    document.getElementById("carrito-count").textContent = totalPiezas;
    document.getElementById("carrito-valor").textContent = "$" + valor.toFixed(2);
    document.getElementById("carrito-entrega").classList.toggle("visible", totalPiezas > 0);

    // Vista previa en vivo de lo que se ha ido escaneando/agregando
    const preview = document.getElementById("carrito-preview");
    if (preview) {
        preview.innerHTML = items.slice().reverse().map(([codigo, e]) => {
            const foto = ikFoto(e.item.foto || e.item.img, 80) || '';
            return `<div class="carrito-preview-item">
                <img src="${sanitizar(foto)}" onerror="this.style.display='none'">
                <div class="cpi-info">
                    <div class="cpi-codigo">${sanitizar(codigo)}</div>
                    <div class="cpi-nombre">${sanitizar(e.item.nombre || '')}</div>
                </div>
                <div class="cpi-qty">×${e.qty}</div>
                <button class="cpi-quitar" onclick="cambiarQtyEntrega('${codigo.replace(/'/g,"\\'")}',-${e.qty})" title="Quitar">✕</button>
            </div>`;
        }).join('');
    }
}

function vaciarCarritoEntrega() {
    if (!Object.keys(carritoEntrega).length) return;
    if (!confirm("¿Vaciar todo el carrito? Se perderá lo que llevas agregado (aún no guardado).")) return;
    carritoEntrega = {};
    actualizarCarritoEntrega();
    filtrarProductosEntrega();
}

function filtrarProductosEntrega() {
    const busq = document.getElementById("bus-entrega").value.toLowerCase();
    if (!busq) { renderGridEntrega(productosDisponibles); return; }
    const filtrados = productosDisponibles.filter(p => {
        const nombre     = (p.nombre || "").toLowerCase();
        const nombreBase = (p.nombre_base || nombre.replace(/ t\d+$/i, "")).toLowerCase();
        const codigo     = (p.codigo || "").toLowerCase();
        const codigoBas  = getCodigoBase(codigo);   // extrae código base del código
        return nombre.includes(busq) || nombreBase.includes(busq)
            || codigo.includes(busq) || codigoBas.includes(busq);
    });
    renderGridEntrega(filtrados);
}

// ── FIRMA DIGITAL ────────────────────────────────────────────────────
let _firmaActiva = false;
let _firmaCodigoActual = "";

function generarCodigoFirma() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// Guarda el avance seleccionado como borrador — SIN firma, SIN entrega física,
// SIN publicar en el link del vendedor. Solo respalda en el servidor para no
// perder el progreso si se arma la lista en varias sesiones.
async function guardarBorrador() {
    const items = Object.values(carritoEntrega).map(e => ({
        id:          Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        codigo:      e.item.codigo,
        codigoBase:  e.item.codigoBase || getCodigoBase(e.item.codigo),
        talla:       e.item.talla || getTallaFromCodigo(e.item.codigo) || "",
        nombre:      e.item.nombre,
        nombre_base: e.item.nombre_base || (e.item.nombre || "").replace(/ T\d+$/i, "").trim(),
        categoria:   e.item.categoria || getCodigoBase(e.item.codigo).match(/^[A-Z]+/)?.[0] || "GEN",
        precio:      e.item.precio || e.item.precioNum || 0,
        cantidad:    e.qty,
        foto:        e.item.foto || e.item.img || ""
    }));
    if (!items.length) { toast("⚠️ Agrega al menos un producto"); return; }

    const btn = document.getElementById("btn-guardar-borrador");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Guardando..."; }
    try {
        const res = await apiPost({ accion: "REGISTRAR_ENTREGA", vendedor: vendedorActual.codigo, items, borrador: true });
        const guardados = new Set(res.guardados || (res.ok ? items.map(i => i.codigo) : []));
        const fallidos  = res.fallidos || [];

        // Solo quitar del carrito lo que SÍ se guardó — lo fallido se queda
        // para poder reintentarlo, en vez de perderse en silencio.
        items.filter(item => guardados.has(item.codigo)).forEach(item => {
            consignacion.push({ ...item, vendedor: vendedorActual.codigo, vendido: 0, estado: "borrador" });
            delete carritoEntrega[item.codigo];
        });

        if (fallidos.length > 0) {
            toast("⚠️ " + guardados.size + " guardados, " + fallidos.length + " FALLARON: " + fallidos.map(f => f.codigo).join(", "));
            actualizarCarritoEntrega();
        } else {
            toast("📝 " + guardados.size + " producto(s) guardados en borrador — aún no entregados ni publicados");
            volverPerfil();
        }
        renderPerfilStats();
    } catch(e) {
        toast("⚠️ Error al guardar — nada se perdió, sigue en el carrito: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "📝 Borrador (guardar, no publicar)"; }
    }
}

function abrirModalFirma() {
    const items = Object.values(carritoEntrega);
    if (!items.length) return;
    _firmaCodigoActual = generarCodigoFirma();
    document.getElementById("firma-vendedor-nombre").textContent = vendedorActual.nombre;
    document.getElementById("firma-codigo").textContent = _firmaCodigoActual;
    limpiarFirma();
    abrirModal("modal-firma");
    inicializarCanvasFirma();
    const btnConfirmar = document.getElementById("btn-confirmar-firma");
    if (btnConfirmar) btnConfirmar.setAttribute("onclick", "confirmarEntregaConFirma()");
}

function inicializarCanvasFirma() {
    const canvas = document.getElementById("firma-canvas");
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let dibujando = false;
    let ultimoX = 0, ultimoY = 0;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if (e.touches) {
            return {
                x: (e.touches[0].clientX - rect.left) * scaleX,
                y: (e.touches[0].clientY - rect.top) * scaleY
            };
        }
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function iniciar(e) {
        e.preventDefault();
        dibujando = true;
        _firmaActiva = true;
        document.getElementById("firma-placeholder").style.display = "none";
        const pos = getPos(e);
        ultimoX = pos.x; ultimoY = pos.y;
        ctx.beginPath();
        ctx.moveTo(ultimoX, ultimoY);
    }

    function dibujar(e) {
        e.preventDefault();
        if (!dibujando) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ultimoX = pos.x; ultimoY = pos.y;
    }

    function terminar(e) { e.preventDefault(); dibujando = false; }

    canvas.removeEventListener("mousedown", canvas._mousedown);
    canvas.removeEventListener("mousemove", canvas._mousemove);
    canvas.removeEventListener("mouseup", canvas._mouseup);
    canvas.removeEventListener("touchstart", canvas._touchstart);
    canvas.removeEventListener("touchmove", canvas._touchmove);
    canvas.removeEventListener("touchend", canvas._touchend);

    canvas._mousedown = iniciar; canvas._mousemove = dibujar; canvas._mouseup = terminar;
    canvas._touchstart = iniciar; canvas._touchmove = dibujar; canvas._touchend = terminar;

    canvas.addEventListener("mousedown", iniciar);
    canvas.addEventListener("mousemove", dibujar);
    canvas.addEventListener("mouseup", terminar);
    canvas.addEventListener("touchstart", iniciar, { passive: false });
    canvas.addEventListener("touchmove", dibujar, { passive: false });
    canvas.addEventListener("touchend", terminar, { passive: false });
}

function limpiarFirma() {
    const canvas = document.getElementById("firma-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _firmaActiva = false;
    document.getElementById("firma-placeholder").style.display = "block";
}

// El botón cerraba el modal de firma al instante y volvía a quedar
// clickeable mientras confirmarEntrega() seguía en curso — un doble toque
// (muy fácil en tablet) disparaba dos REGISTRAR_ENTREGA para el mismo
// carrito. Cada uno suma su propia cantidad a stock_consignacion (delta, no
// valor fijo), así que el contador terminaba duplicado aunque solo se haya
// entregado una vez físicamente — el caso real que encontró esto fue
// PUP105 con Jaime Solórzano: 1 pieza entregada, quedó registrada como 2.
let _confirmandoEntrega = false;
async function confirmarEntregaConFirma() {
    if (_confirmandoEntrega) return;
    if (!_firmaActiva) { toast("⚠️ El vendedor debe firmar primero"); return; }
    _confirmandoEntrega = true;
    const btn = document.getElementById("btn-confirmar-firma");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Confirmando..."; }
    try {
        const firmaImg = document.getElementById("firma-canvas").toDataURL("image/png");
        cerrarModal("modal-firma");
        await confirmarEntrega(firmaImg, _firmaCodigoActual);
    } finally {
        _confirmandoEntrega = false;
        if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmar y Generar Recibo"; }
    }
}

// ── Firma digital del contrato de vendedor/afiliado ──────────────────
let _vendedorPendienteFirma = null;
let _firmaContratoActiva = false;

function abrirFirmaContrato(vendedor) {
    _vendedorPendienteFirma = vendedor;
    _firmaContratoActiva = false;
    document.getElementById("firma-contrato-vendedor-nombre").textContent = vendedor.nombre;
    limpiarFirmaContrato();
    abrirModal("modal-firma-contrato");
    inicializarCanvasGenerico("firma-contrato-canvas", "firma-contrato-placeholder", () => { _firmaContratoActiva = true; });
}

function inicializarCanvasGenerico(canvasId, placeholderId, onFirstStroke) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let dibujando = false;
    let ultimoX = 0, ultimoY = 0;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if (e.touches) {
            return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
        }
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function iniciar(e) {
        e.preventDefault();
        dibujando = true;
        if (onFirstStroke) onFirstStroke();
        const ph = document.getElementById(placeholderId);
        if (ph) ph.style.display = "none";
        const pos = getPos(e);
        ultimoX = pos.x; ultimoY = pos.y;
        ctx.beginPath();
        ctx.moveTo(ultimoX, ultimoY);
    }

    function dibujar(e) {
        e.preventDefault();
        if (!dibujando) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ultimoX = pos.x; ultimoY = pos.y;
    }

    function terminar(e) { e.preventDefault(); dibujando = false; }

    canvas.removeEventListener("mousedown", canvas._mousedown);
    canvas.removeEventListener("mousemove", canvas._mousemove);
    canvas.removeEventListener("mouseup", canvas._mouseup);
    canvas.removeEventListener("touchstart", canvas._touchstart);
    canvas.removeEventListener("touchmove", canvas._touchmove);
    canvas.removeEventListener("touchend", canvas._touchend);

    canvas._mousedown = iniciar; canvas._mousemove = dibujar; canvas._mouseup = terminar;
    canvas._touchstart = iniciar; canvas._touchmove = dibujar; canvas._touchend = terminar;

    canvas.addEventListener("mousedown", iniciar);
    canvas.addEventListener("mousemove", dibujar);
    canvas.addEventListener("mouseup", terminar);
    canvas.addEventListener("touchstart", iniciar, { passive: false });
    canvas.addEventListener("touchmove", dibujar, { passive: false });
    canvas.addEventListener("touchend", terminar, { passive: false });
}

function limpiarFirmaContrato() {
    const canvas = document.getElementById("firma-contrato-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _firmaContratoActiva = false;
    document.getElementById("firma-contrato-placeholder").style.display = "block";
}

async function confirmarFirmaContrato() {
    if (!_vendedorPendienteFirma) return;
    if (!_firmaContratoActiva) { toast("⚠️ Falta la firma"); return; }
    const firmaImg = document.getElementById("firma-contrato-canvas").toDataURL("image/png");
    const v = _vendedorPendienteFirma;
    v.firmaContrato = firmaImg;
    v.firmaContratoFecha = new Date().toISOString();
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: v });
    cerrarModal("modal-firma-contrato");
    generarContratoPDF(v);
    _vendedorPendienteFirma = null;
    toast("✅ Contrato firmado digitalmente");
}

function omitirFirmaContrato() {
    if (!_vendedorPendienteFirma) { cerrarModal("modal-firma-contrato"); return; }
    const v = _vendedorPendienteFirma;
    cerrarModal("modal-firma-contrato");
    generarContratoPDF(v);
    _vendedorPendienteFirma = null;
}

// El admin marca esto cuando YA tiene en mano el papel firmado (después de
// "Firmar después (físico)"). Sin esto, un afiliado que firmó en papel
// quedaría bloqueado para generar su catálogo, igual que uno que nunca firmó.
async function marcarFirmadoFisico() {
    if (!vendedorActual) return;
    if (!confirm(`¿Confirmas que ya tienes en mano el contrato de ${vendedorActual.nombre} firmado en papel?`)) return;
    vendedorActual.firmadoFisico = true;
    vendedorActual.firmadoFisicoFecha = new Date().toISOString();
    await apiPost({ accion: "GUARDAR_VENDEDOR", vendedor: vendedorActual });
    toast("✅ Marcado como firmado en papel");
    abrirPerfil(vendedorActual.codigo);
}

async function descargarContratoActual() {
    if (!vendedorActual) return;
    // Refrescar por si el afiliado firmó a distancia después de la última carga
    try {
        const res = await fetch(API_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ accion: "GET_CONSIGNACION", _pass: _sessionPass }) });
        const data = await res.json();
        if (data.vendedores) {
            vendedores = data.vendedores;
            const actualizado = vendedores.find(v => v.codigo === vendedorActual.codigo);
            if (actualizado) vendedorActual = actualizado;
        }
    } catch(_) {}
    generarContratoPDF(vendedorActual);
}

async function enviarLinkFirmaRemota() {
    if (!_vendedorPendienteFirma) return;
    const v = _vendedorPendienteFirma;
    const token = generarLinkId();
    await apiPost({ accion: "GUARDAR_TOKEN_FIRMA", vendedor: v.codigo, token });
    v.tokenFirma = token;
    const link = "https://verex-nexus.pages.dev/firmar.html?v=" + encodeURIComponent(v.codigo) + "&token=" + encodeURIComponent(token);
    const tel = String(v.telefono || "").replace(/\D/g, "");
    const msg = "Hola " + v.nombre + "! Para completar tu registro con VEREX, por favor firma tu contrato aquí:\n" + link;
    cerrarModal("modal-firma-contrato");
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
    toast("📱 Link de firma enviado — el contrato se generará automáticamente cuando firme");
    _vendedorPendienteFirma = null;
}

// Genera (o reusa) el token del portal de pedidos del afiliado y comparte el
// link por WhatsApp — ahí completa nombre/teléfono/dirección de sus ventas
// cerradas antes de que VEREX las confirme.
// El link del catálogo de cada afiliado sigue siempre el mismo patrón fijo,
// basado en su nombre (igual que generarIdAfiliado() en Admin) — así que se
// puede reconstruir aquí sin necesidad de guardar/consultar nada extra.
function verCatalogoActualAfiliado() {
    if (!vendedorActual) return;
    const slug = (vendedorActual.nombre || "")
        .toLowerCase()
        .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
        .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u').replace(/ñ/g,'n')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if (!slug) return toast("⚠️ No se pudo generar el link — falta el nombre del vendedor");
    window.open("https://admin-tienda.pages.dev/c/" + slug, "_blank");
}

async function enviarLinkPedidos() {
    if (!vendedorActual) return;
    let token = vendedorActual.tokenPedidos;
    if (!token) {
        token = generarLinkId();
        await apiPost({ accion: "GUARDAR_TOKEN_PEDIDOS", vendedor: vendedorActual.codigo, token });
        vendedorActual.tokenPedidos = token;
    }
    const link = "https://verex-nexus.pages.dev/pedido.html?v=" + encodeURIComponent(vendedorActual.codigo) + "&token=" + encodeURIComponent(token);
    const tel = String(vendedorActual.telefono || "").replace(/\D/g, "");
    const msg = "Hola " + vendedorActual.nombre + "! Aquí completas los datos (nombre, teléfono y dirección) de tus pedidos cerrados, para que VEREX pueda confirmarlos:\n" + link;
    try { await navigator.clipboard.writeText(link); } catch(_){}
    window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg));
    toast("🔗 Link copiado y enviado por WhatsApp");
}

async function confirmarEntrega(firmaImg, codigoFirma) {
    firmaImg = firmaImg || null;
    codigoFirma = codigoFirma || "";
    const items = Object.values(carritoEntrega).map(e => ({
        id:          Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        codigo:      e.item.codigo,                                // "AN021T10"
        codigoBase:  e.item.codigoBase || getCodigoBase(e.item.codigo), // "AN021"
        talla:       e.item.talla || getTallaFromCodigo(e.item.codigo) || "",
        nombre:      e.item.nombre,
        nombre_base: e.item.nombre_base || (e.item.nombre || "").replace(/ T\d+$/i, "").trim(),
        categoria:   e.item.categoria || getCodigoBase(e.item.codigo).match(/^[A-Z]+/)?.[0] || "GEN",
        precio:      e.item.precio || e.item.precioNum || 0,
        cantidad:    e.qty,
        foto:        e.item.foto || e.item.img || ""
    }));
    if (!items.length) return;

    // Registrar en el backend — si falla, continuar de todas formas para generar el PDF
    // (el vendedor ya firmó físicamente), pero avisar si algún item no se guardó.
    let fallidosEntrega = [];
    try {
        const resEnt = await apiPost({ accion: "REGISTRAR_ENTREGA", vendedor: vendedorActual.codigo, items });
        fallidosEntrega = resEnt.fallidos || [];
    } catch(e) { console.warn("REGISTRAR_ENTREGA error:", e); fallidosEntrega = items.map(i => ({codigo: i.codigo})); }

    items.forEach(item => consignacion.push({ ...item, vendedor: vendedorActual.codigo, vendido: 0, estado: "activo" }));

    const entregaId = "ENT_" + Date.now();
    try {
        await apiPost({
            accion: "REGISTRAR_ENTREGA_PENDIENTE",
            id: entregaId,
            vendedor: vendedorActual.codigo,
            items,
            codigoRecibo: codigoFirma || generarCodigoFirma()
        });
    } catch(e) { console.warn("REGISTRAR_ENTREGA_PENDIENTE error:", e); }

    // Guardar copia del vendedor actual antes de volver al perfil
    const vendedorParaPDF = { ...vendedorActual };

    if (fallidosEntrega.length > 0) {
        toast("⚠️ OJO: " + fallidosEntrega.length + " producto(s) NO se guardaron en el sistema: " + fallidosEntrega.map(f => f.codigo).join(", "));
    } else {
        toast("✅ Entrega registrada — generando recibo...");
    }
    volverPerfil();
    renderPerfilStats();
    renderInventario();
    setTimeout(() => {
        try {
            generarReciboPDF(vendedorParaPDF, items, firmaImg, codigoFirma);
        } catch(e) {
            console.error("Error generando recibo PDF:", e);
            toast("⚠️ Error al generar PDF: " + e.message);
        }
    }, 400);
}