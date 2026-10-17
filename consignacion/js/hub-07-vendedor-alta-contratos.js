// Hub VEREX — Alta/edición de vendedor, hoja informativa y contratos PDF
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
function selTipoVendedor(tipo) {
    _tipoVendedorSel = tipo;
    const btnConsig  = document.getElementById("v-tipo-consig-btn");
    const btnAfil    = document.getElementById("v-tipo-afiliado-btn");
    const btnHibrido = document.getElementById("v-tipo-hibrido-btn");
    const desc       = document.getElementById("v-tipo-desc");
    const fisicoWrap = document.getElementById("v-recibe-fisico-wrap");
    const btnHojaInfo = document.getElementById("v-btn-hoja-info");
    const off = s => { s.style.background = "var(--gris2)"; s.style.color = "var(--blanco)"; s.style.borderColor = "var(--borde)"; };
    const on  = s => { s.style.background = "var(--dorado)"; s.style.color = "#111"; s.style.borderColor = "var(--dorado)"; };
    off(btnConsig); off(btnAfil); if (btnHibrido) off(btnHibrido);
    if (tipo === "afiliado") {
        on(btnAfil);
        desc.textContent = "No maneja piezas físicas — cierra la venta por su cuenta y pide la pieza a VEREX para entregarla.";
        if (fisicoWrap) fisicoWrap.style.display = "flex";
        if (btnHojaInfo) btnHojaInfo.style.display = "block";
    } else if (tipo === "hibrido") {
        if (btnHibrido) on(btnHibrido);
        desc.textContent = "Recibe piezas físicas en consignación Y tiene catálogo digital de afiliado.";
        if (fisicoWrap) fisicoWrap.style.display = "none";
        if (btnHojaInfo) btnHojaInfo.style.display = "block";
    } else {
        on(btnConsig);
        desc.textContent = "Recibe piezas físicas, vende, devuelve lo no vendido.";
        if (fisicoWrap) fisicoWrap.style.display = "none";
        if (btnHojaInfo) btnHojaInfo.style.display = "none";
    }
}

// Hoja informativa para el afiliado — explica la dinámica de venta y comisiones
// ANTES de llenar la ficha y generar el contrato. No usa datos de ningún vendedor
// en particular (aún no existe), es información general del programa.
function generarHojaInformativaAfiliadoPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210;
    const mL = 20, mR = 20;
    const textW = pageW - mL - mR;
    let y = 20;

    function checkPage(needed) {
        if (y + needed > 280) { doc.addPage(); y = 20; }
    }
    function seccion(titulo) {
        checkPage(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(201, 168, 76);
        doc.text(titulo, mL, y); y += 6;
    }
    function parrafo(texto) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        const lines = doc.splitTextToSize(texto, textW);
        checkPage(lines.length * 5 + 3);
        doc.text(lines, mL, y); y += lines.length * 5 + 5;
    }
    function bullet(texto) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(40, 40, 40);
        const lines = doc.splitTextToSize(texto, textW - 6);
        checkPage(lines.length * 5 + 2);
        doc.text("•", mL, y);
        doc.text(lines, mL + 5, y); y += lines.length * 5 + 3;
    }

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(201, 168, 76);
    doc.text("VEREX", pageW / 2, y, { align: "center" }); y += 8;
    doc.setFontSize(12);
    doc.setTextColor(80, 80, 80);
    doc.text("PROGRAMA DE AFILIADOS — CÓMO FUNCIONA", pageW / 2, y, { align: "center" }); y += 12;

    parrafo("Esta hoja explica la dinámica de venta y comisiones del Programa de Afiliados VEREX antes de registrarte. Léela con calma — si tienes dudas, pregúntanos antes de firmar el contrato.");

    seccion("1. ¿QUÉ ES SER AFILIADO?");
    parrafo("Recibes un catálogo digital personalizado con los productos VEREX que definamos juntos. Tú lo compartes con tus clientes (WhatsApp, redes sociales, boca a boca) y gestionas la venta por tu cuenta. No necesitas comprar inventario ni arriesgar tu dinero — VEREX es dueña de las piezas hasta que se venden.");

    seccion("2. CÓMO SE REGISTRA UNA VENTA");
    bullet("Un cliente ve tu catálogo digital y presiona el botón \"¡Hazlo tuyo!\" en el producto que le interesa.");
    bullet("El catálogo le pide al cliente su nombre, número de WhatsApp y dirección de entrega antes de enviar el mensaje. Esos datos quedan registrados automáticamente como un interesado (Lead) a tu nombre — ya completos, sin que tú tengas que hacer nada extra.");
    bullet("Se abre WhatsApp con un mensaje pre-armado que incluye el producto, precio, talla (si aplica) y los datos del cliente. El cliente solo presiona Enviar.");
    bullet("También puede usar el carrito: agrega varios productos, llena sus datos una sola vez y manda todo en un solo mensaje de WhatsApp al final.");
    bullet("En tu link personal de \"Completar Pedidos\" (te lo comparte VEREX) verás el pedido ya precargado con los datos que el cliente ingresó en el catálogo. Revisa que todo esté correcto y confírmalo — ese paso es obligatorio para que VEREX pueda coordinar la entrega.");
    bullet("Tú coordinas con VEREX la entrega. Las ventas de afiliado son contra entrega, en efectivo, con envío gratis en pedidos desde $30.");
    bullet("La venta se confirma oficialmente cuando VEREX verifica que la pieza fue entregada — solo hasta ese momento se genera tu comisión. Esto protege a ambas partes: ni tú cargas con inventario no vendido, ni se paga comisión por ventas que no se concretaron.");

    seccion("3. TU COMISIÓN");
    parrafo("Ganas comisión por tramos según el total de ventas confirmadas en el período — entre más vendas, mayor tu porcentaje:");

    checkPage(35);
    doc.setFillColor(30, 30, 30);
    doc.rect(mL, y, textW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Ventas confirmadas del período", mL + 4, y + 5);
    doc.text("Tu comisión", mL + 120, y + 5); y += 8;
    RANGOS_COMISION_AFILIADO.forEach((r, i) => {
        const rango = r.max >= 99999 ? `$${r.min} o más` : `$${r.min} — $${r.max}`;
        doc.setFillColor(i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255, i % 2 === 0 ? 248 : 255);
        doc.rect(mL, y, textW, 7, 'F');
        doc.setTextColor(40, 40, 40);
        doc.setFont("helvetica", "normal");
        doc.text(rango, mL + 4, y + 5);
        doc.setFont("helvetica", "bold");
        doc.text(r.pct + "%", mL + 120, y + 5); y += 7;
    });
    y += 10;

    seccion("4. ¿RECIBES PIEZAS FÍSICAS O NO?");
    bullet("Sin piezas físicas (lo más común): tú solo cierras la venta, VEREX se encarga de la entrega. No tienes responsabilidad sobre el inventario.");
    bullet("Con piezas físicas (si se acuerda contigo): VEREX te entrega algunas piezas para que tú mismo las entregues a tus clientes. En ese caso, eres responsable de esas piezas — si se pierden, roban o dañan, se descuenta el valor de venta menos tu comisión.");

    seccion("5. PRECIOS Y REGLAS");
    bullet("Vendes al precio que aparece en el catálogo — no puedes cambiar precios sin autorización de VEREX.");
    bullet("El catálogo se actualiza en tiempo real: los productos agotados desaparecen automáticamente — no se marcan ni se grisan, simplemente dejan de aparecer. Esto incluye pares y tríos: si una pieza del conjunto se vende en otro canal, todo el set desaparece del catálogo para que no ofrezcas algo que ya no está disponible.");

    seccion("6. GARANTÍA LIMITADA — LÉELA ANTES DE VENDER");
    parrafo("VEREX tiene una Garantía Limitada de 30 días, válida únicamente contra defectos de fabricación (piedras mal engastadas de fábrica, broches o soldaduras defectuosas). NO cubre golpes, mal uso, cadenas reventadas por jalones, ni el oscurecimiento/oxidación de la plata — eso es una reacción natural del material con el pH de la piel, sudor, perfumes, cremas o cloro, no un defecto.");
    checkPage(30);
    doc.setFillColor(240, 249, 255);
    doc.rect(mL, y, textW, 22, 'F');
    doc.setDrawColor(14, 165, 233);
    doc.rect(mL, y, textW, 22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(14, 116, 144);
    doc.text("Lee la política completa de Garantía Limitada aquí:", mL + 4, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(2, 132, 199);
    doc.textWithLink("admin-tienda.pages.dev/garantia.html", mL + 4, y + 15, { url: "https://admin-tienda.pages.dev/garantia.html" });
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text("(o pide a VEREX el QR para escanearlo)", mL + 4, y + 20);
    y += 27;
    bullet("Antes de ofrecerle algo a un cliente (cambio, reembolso, reparación), consulta esa página o pregúntale a VEREX — así no le prometes algo que la garantía no cubre.");

    seccion("7. ¿CUÁNDO SE PAGA?");
    parrafo("Tu comisión se liquida en el corte de cuentas, que se realiza cada 30 días, únicamente sobre las ventas que VEREX ya confirmó como entregadas.");

    seccion("8. SIGUIENTE PASO");
    parrafo("Si estás de acuerdo con esta dinámica, VEREX registrará tu ficha y generará tu contrato de afiliado con estas mismas condiciones para que lo firmes (en persona o a distancia).");

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text("VEREX — Programa de Afiliados · Información general, sujeta a lo acordado en tu contrato", pageW / 2, 292, { align: "center" });

    doc.save("VEREX_Programa_Afiliados_Info.pdf");
    toast("📄 Hoja informativa generada");
}

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
