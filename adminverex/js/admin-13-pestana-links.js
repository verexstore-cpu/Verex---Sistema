// Admin VEREX — Pestaña «🔗 Links»: vista consolidada de todos los catálogos
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  PESTAÑA "🔗 LINKS" — vista consolidada de todos los catálogos
//  (clientes + afiliados), leída directo de la base de datos, no del
//  localStorage — así se ve igual desde cualquier PC o el celular.
// ═════════════════════════════════════════════
let _todosLosLinks = [];

let _cierresMensuales = [];
const MESES_CIERRE = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function _poblarSelectoresCierre() {
    const selMes  = document.getElementById("cierre-mes-sel");
    const selAnio = document.getElementById("cierre-anio-sel");
    if (!selMes || !selAnio || selMes.options.length) return; // ya poblados
    MESES_CIERRE.forEach((nombre, i) => {
        const opt = document.createElement("option");
        opt.value = i + 1; opt.textContent = nombre;
        selMes.appendChild(opt);
    });
    const ahora = new Date();
    const anioActual = ahora.getUTCFullYear();
    for (let a = anioActual; a >= anioActual - 3; a--) {
        const opt = document.createElement("option");
        opt.value = a; opt.textContent = a;
        selAnio.appendChild(opt);
    }
    // Default: mes anterior al actual (el mismo que el cierre automático)
    let mesDef = ahora.getUTCMonth(); // getUTCMonth() ya es 0-indexado = mes anterior en 1-indexado
    let anioDef = anioActual;
    if (mesDef === 0) { mesDef = 12; anioDef -= 1; }
    selMes.value = mesDef;
    selAnio.value = anioDef;
}

async function cargarCierresMensuales() {
    _poblarSelectoresCierre();
    const cont = document.getElementById("cierres-lista");
    cont.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:20px;">Cargando...</p>';
    try {
        const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_CIERRES_MENSUALES", _pass: ADMIN_PASS }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error");
        _cierresMensuales = data.cierres || [];
        renderCierresMensuales();
    } catch (e) {
        cont.innerHTML = `<p style="color:#ef4444;text-align:center;padding:20px;">⚠️ Error cargando cierres: ${esc(e.message)}</p>`;
    }
}

function renderCierresMensuales() {
    const cont = document.getElementById("cierres-lista");
    if (!_cierresMensuales.length) {
        cont.innerHTML = '<div class="card"><p style="color:#6b7280;text-align:center;padding:20px;">Todavía no hay cierres generados. El primero saldrá automáticamente el día 1 del próximo mes, o genera uno ahora con el botón de arriba.</p></div>';
        return;
    }
    cont.innerHTML = _cierresMensuales.map(c => {
        const nombreMes = `${MESES_CIERRE[c.mes-1] || c.mes} ${c.anio}`;
        const topVendedores = (c.porVendedor||[]).slice(0,5).map(v =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:12.5px;">
                <span>${esc(v.nombre||v.vendedor)} ${v.esAfiliadoSinStock?'<span style="color:#7c3aed;font-size:10px;">(afiliado)</span>':''}</span>
                <strong>$${v.total.toFixed(2)}</strong>
            </div>`).join('') || '<p style="color:#9ca3af;font-size:12px;">Sin ventas de vendedores este mes.</p>';
        return `
        <div class="card" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;">
                <h2 style="margin:0;">${nombreMes}</h2>
                <span style="font-size:11px;color:#9ca3af;">Generado: ${new Date(c.generadoEn).toLocaleString('es-SV')}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0;">
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:3px solid #0369a1;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10.5px;color:#6b7280;text-transform:uppercase;">Ecommerce</div>
                    <div style="font-size:19px;font-weight:800;">$${c.ecommerce.total.toFixed(2)}</div>
                    <div style="font-size:11px;color:#9ca3af;">${c.ecommerce.cantidad} pedido(s)</div>
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:3px solid #059669;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10.5px;color:#6b7280;text-transform:uppercase;">Venta Directa</div>
                    <div style="font-size:19px;font-weight:800;">$${c.ventaDirecta.total.toFixed(2)}</div>
                    <div style="font-size:11px;color:#9ca3af;">${c.ventaDirecta.cantidad} venta(s)</div>
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:3px solid #7c3aed;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10.5px;color:#6b7280;text-transform:uppercase;">Afiliados sin stock</div>
                    <div style="font-size:19px;font-weight:800;">$${c.afiliadosSinStock.total.toFixed(2)}</div>
                    <div style="font-size:11px;color:#9ca3af;">${c.afiliadosSinStock.cantidad} unidad(es)</div>
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:3px solid #C9A84C;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:10.5px;color:#6b7280;text-transform:uppercase;">Consignación</div>
                    <div style="font-size:19px;font-weight:800;">$${c.consignacion.total.toFixed(2)}</div>
                    <div style="font-size:11px;color:#9ca3af;">${c.consignacion.cantidad} unidad(es)</div>
                </div>
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;padding:12px;background:#f9fafb;border-radius:10px;margin-bottom:14px;">
                <div><div style="font-size:11px;color:#6b7280;">Ingreso real de VEREX (caja)</div><div style="font-size:20px;font-weight:800;color:#059669;">$${c.ingresoRealVerex.toFixed(2)}</div></div>
                <div><div style="font-size:11px;color:#6b7280;">Total general (incl. consignación por liquidar)</div><div style="font-size:20px;font-weight:800;color:#1a1a1a;">$${c.totalGeneral.toFixed(2)}</div></div>
            </div>
            <div style="font-size:12px;font-weight:700;color:#6b7280;margin-bottom:4px;text-transform:uppercase;">Top vendedores/afiliados del mes</div>
            ${topVendedores}
        </div>`;
    }).join('');
}

async function generarCierreManual() {
    const mesSel  = document.getElementById("cierre-mes-sel")?.value;
    const anioSel = document.getElementById("cierre-anio-sel")?.value;
    const nombreMesSel = MESES_CIERRE[parseInt(mesSel)-1] || mesSel;
    if (!confirm(`¿Generar/actualizar el cierre de ${nombreMesSel} ${anioSel} con los datos actuales? Es seguro correrlo varias veces, siempre recalcula con la info más reciente.`)) return;
    const btn = event.target;
    const txtOriginal = btn.textContent;
    btn.textContent = "⏳ Generando..."; btn.disabled = true;
    try {
        const res  = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"CERRAR_MES", _pass: ADMIN_PASS, mes: mesSel, anio: anioSel }) });
        const data = await res.json();
        if (data.ok) { toast("✅ Cierre generado"); await cargarCierresMensuales(); }
        else alert("⚠️ " + (data.error||"No se pudo generar el cierre"));
    } catch(e) { alert("⚠️ Error de conexión"); }
    btn.textContent = txtOriginal; btn.disabled = false;
}

async function cargarPanelLinks() {
    const cont = document.getElementById("lk-lista");
    cont.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:20px;">Cargando...</p>';
    try {
        const res = await fetch("/list-catalogs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _pass: ADMIN_PASS })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error");
        _todosLosLinks = data.catalogos || [];
        renderPanelLinks();
    } catch (e) {
        cont.innerHTML = `<p style="color:#ef4444;text-align:center;padding:20px;">⚠️ Error cargando links: ${esc(e.message)}</p>`;
    }
}

function renderPanelLinks() {
    const cont = document.getElementById("lk-lista");
    const busq = (document.getElementById("lk-buscar")?.value || "").toLowerCase().trim();
    const filtroTipo = document.getElementById("lk-tipo")?.value || "";
    const filtroEstado = document.getElementById("lk-estado")?.value || "";

    let lista = _todosLosLinks;
    if (filtroTipo === "lyra") lista = lista.filter(c => c.creadoPor === "lyra");
    else if (filtroTipo) lista = lista.filter(c => c.tipo === filtroTipo);
    if (filtroEstado === "activo") lista = lista.filter(c => c.activo);
    if (filtroEstado === "vencido") lista = lista.filter(c => !c.activo);
    if (busq) lista = lista.filter(c =>
        (c.nombre || "").toLowerCase().includes(busq) ||
        (c.afiliadoCodigo || "").toLowerCase().includes(busq) ||
        (c.id || "").toLowerCase().includes(busq)
    );

    document.getElementById("lk-total-activos").textContent = _todosLosLinks.filter(c => c.activo).length;
    document.getElementById("lk-total-vistas").textContent = _todosLosLinks.reduce((s, c) => s + (c.vistas || 0), 0);
    document.getElementById("lk-total-vencidos").textContent = _todosLosLinks.filter(c => !c.activo).length;

    if (!lista.length) {
        cont.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:20px;">No hay links que coincidan con el filtro.</p>';
        return;
    }

    cont.innerHTML = lista.map(c => {
        const fechaGen = c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" }) : "—";
        const fechaVence = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("es-SV", { day: "numeric", month: "short" }) : "—";
        const badgeTipo = c.tipo === "afiliado"
            ? `<span style="font-size:10px;font-weight:700;color:#7c3aed;background:#ede9fe;border-radius:5px;padding:2px 8px;">🤝 Afiliado${c.afiliadoCodigo ? " · " + esc(c.afiliadoCodigo) : ""}</span>`
            : `<span style="font-size:10px;font-weight:700;color:#0369a1;background:#e0f2fe;border-radius:5px;padding:2px 8px;">👤 Cliente</span>`;
        const badgeEstado = c.activo
            ? `<span style="font-size:10px;font-weight:700;color:#059669;background:#d1fae5;border-radius:5px;padding:2px 8px;">● ACTIVO</span>`
            : `<span style="font-size:10px;font-weight:700;color:#9ca3af;background:#f3f4f6;border-radius:5px;padding:2px 8px;">● VENCIDO</span>`;
        return `<div style="background:#fff;border:1px solid #e5e7eb;border-left:3px solid ${c.activo ? "#059669" : "#d1d5db"};border-radius:10px;padding:14px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap;">
                <div style="min-width:0;">
                    <div style="font-weight:700;color:#111827;font-size:14px;">${esc(c.nombre || "(Sin nombre)")}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${badgeTipo}${c.creadoPor === "lyra" ? `<span style="font-size:10px;font-weight:700;color:#be185d;background:#fce7f3;border-radius:5px;padding:2px 8px;">🤖 Creado por Lyra</span>` : ""}${badgeEstado}</div>
                    ${c.nota ? `<div style="font-size:11px;color:#6b7280;margin-top:5px;font-style:italic;">📝 ${esc(c.nota)}</div>` : ""}
                </div>
                <div style="text-align:right;font-size:11px;color:#6b7280;flex-shrink:0;">
                    Generado: ${fechaGen}<br>Vence: ${fechaVence}
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;font-size:12px;color:#374151;">
                <span>👁️ <b>${c.vistas || 0}</b> vista${c.vistas === 1 ? "" : "s"}</span>
                <span>📦 <b>${c.prods || 0}</b> producto${c.prods === 1 ? "" : "s"}</span>
                ${c.ultimaVista ? `<span>Última: ${_tiempoRelativo(c.ultimaVista)}</span>` : ""}
            </div>
            <div style="display:flex;gap:6px;margin-top:10px;">
                ${c.activo ? `
                <button onclick="copiarTexto('${esc(c.url)}','🔗 Link copiado')" style="flex:1;padding:7px 0;background:#111827;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;" title="Copia solo el link, para pegarlo en el navegador">🔗 Copiar link</button>
                <button onclick="copiarTexto(mensajeCompartirCatalogo('${esc(c.url)}'),'💬 Mensaje copiado')" style="flex:0 0 auto;padding:7px 10px;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;" title="Copia el saludo + link, para pegarlo en el chat del cliente">💬</button>
                <a href="${esc(c.url)}" target="_blank" style="flex:1;text-align:center;padding:7px 0;background:#f3f4f6;color:#111827;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;">👁️ Ver</a>
                ${c.wa ? `<a href="https://wa.me/${esc(String(c.wa).replace(/\D/g, ""))}?text=${encodeURIComponent(mensajeCompartirCatalogo(c.url))}" target="_blank" style="flex:1;text-align:center;padding:7px 0;background:#25D366;color:#fff;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;">💬 WhatsApp</a>` : ""}
                <button onclick="cambiarVigenciaLinkPanel('${esc(c.url)}')" style="flex:0 0 auto;padding:7px 10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;" title="Cambiar cuántos días le quedan">⏱️</button>
                <button onclick="desactivarLinkPanel('${esc(c.id)}','${esc(c.nombre || "").replace(/'/g,"\\'")}')" style="flex:0 0 auto;padding:7px 10px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;" title="Desactivar este link">🔒</button>
                ` : `
                <button onclick="reactivarLinkPanel('${esc(c.id)}')" style="flex:1;padding:7px 0;background:#C9A84C;color:#111;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">🔄 Reactivar (nuevo link)</button>
                `}
            </div>
        </div>`;
    }).join("");
}

// Reactivar desde la pestaña Links — funciona desde cualquier dispositivo
// porque la receta ahora vive en la base de datos (KV), no solo en
// localStorage. Si hay receta guardada Y ya se cargó el stock en esta
// sesión (abriendo el tab Catálogo), regenera con productos que SÍ tienen
// stock hoy. Si no, cae al clon simple del snapshot guardado (comportamiento
// anterior — mismos productos que tenía en ese momento, sin filtrar stock).
async function desactivarLinkPanel(id, nombre) {
    if (!confirm(`¿Desactivar "${nombre || "este link"}"? Dejará de funcionar de inmediato y aparecerá como VENCIDO.`)) return;
    try {
        const res = await fetch("/deactivate-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, _pass: ADMIN_PASS })
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || "Error del servidor");
        toast("🔒 Link desactivado", "#22c55e");
        cargarPanelLinks();
    } catch (err) {
        toast("❌ No se pudo desactivar: " + err.message, "#ef4444");
    }
}

async function reactivarLinkPanel(id) {
    const item = _todosLosLinks.find(c => c.id === id);
    const nombre = item?.nombre || "este catálogo";
    const notaTxt = item?.nota ? `\nNota: ${item.nota}` : "";
    const diasStr = prompt(`Reactivar "${nombre}"${notaTxt}\n\n¿Cuántos días de vigencia?`, "7");
    if (!diasStr) return;
    const dias = Math.max(1, Math.min(30, parseInt(diasStr) || 7));
    const nuevaExpiry = Date.now() + dias * 864e5;

    // El descuento/banner NO se reactiva en automático — se pregunta primero,
    // porque una promoción vieja puede ya no estar vigente para ofrecer.
    // Las promos son SOLO para catálogos de Cliente — nunca de Afiliado (igual
    // que en la generación inicial) — así que si el link es de afiliado ni
    // siquiera se pregunta, se descarta directo.
    const esAfiliadoReactivar = item?.tipo === "afiliado";
    const teniaDescuento = !esAfiliadoReactivar && item?.banner && item.descPct > 0;
    const mantenerDescuento = teniaDescuento
        ? confirm(`Este catálogo tenía un descuento del ${item.descPct}% ("${item.banner.txt || ""}"). ¿Sigue vigente y quieres mantenerlo en el nuevo link?\n\nAceptar = mantenerlo\nCancelar = generar sin descuento`)
        : false;

    // Mismo criterio para la promo de carrito (2x50/3x2/monto fijo/escalonado)
    // y los incentivos de envío gratis / regalo sorpresa.
    const nombresPromo = { "2x50": "2do al 50%", "3x2": "3x2", montoFijo: "monto fijo", escalonado: "escalonado por cantidad" };
    const teniaOtrasPromos = !esAfiliadoReactivar && !!(item?.promoCarrito || item?.envioGratisDesde > 0 || item?.regaloSorpresa);
    let mantenerOtras = false;
    if (teniaOtrasPromos) {
        const partes = [];
        if (item.promoCarrito) partes.push(`promo "${nombresPromo[item.promoCarrito.tipo] || item.promoCarrito.tipo}"`);
        if (item.envioGratisDesde > 0) partes.push(`envío gratis desde $${item.envioGratisDesde}`);
        if (item.regaloSorpresa) partes.push(`regalo sorpresa desde $${item.regaloSorpresa.monto}`);
        mantenerOtras = confirm(`Este catálogo también tenía: ${partes.join(", ")}. ¿Sigue vigente y quieres mantenerlo?\n\nAceptar = mantenerlo\nCancelar = generar sin eso`);
    }

    if (item?.receta && _catFiltrada?.length) {
        try {
            await _clonarConStockActual(
                { nombre: item.nombre, nota: item.nota, esAfiliado: item.tipo === "afiliado",
                  banner: mantenerDescuento ? item.banner : null, descPct: mantenerDescuento ? item.descPct : 0,
                  promoCarrito: mantenerOtras ? item.promoCarrito : null,
                  envioGratisDesde: mantenerOtras ? item.envioGratisDesde : 0,
                  regaloSorpresa: mantenerOtras ? item.regaloSorpresa : null },
                item.receta, dias, nuevaExpiry
            );
            cargarPanelLinks();
        } catch (err) {
            toast("❌ " + err.message, "#ef4444");
        }
        return;
    }
    if (item?.receta && !_catFiltrada?.length) {
        toast("ℹ️ Abre el tab Catálogo primero para regenerar con stock actual — reactivando con el snapshot guardado por ahora", "#0277bd");
    }

    try {
        const res = await fetch("/clone-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dias, expiresAt: nuevaExpiry, stripDescuento: teniaDescuento && !mantenerDescuento, stripPromos: teniaOtrasPromos && !mantenerOtras, _pass: ADMIN_PASS })
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || "Error del servidor");
        const nuevaUrl = location.origin + out.url;
        try { await navigator.clipboard.writeText(nuevaUrl); } catch(_){}
        toast("🔗 Nuevo link generado y copiado", "#22c55e");
        cargarPanelLinks();
    } catch (err) {
        toast("❌ No se pudo reactivar: " + err.message, "#ef4444");
    }
}

async function clonarCatalogo(id, nombre) {
    const fechaInput = document.getElementById("reac-fecha-" + id);
    if (!fechaInput?.value) return toast("⚠️ Elige una fecha de vigencia", "#f97316");
    const nuevaExpiry = new Date(fechaInput.value + "T23:59:59").getTime();
    if (nuevaExpiry <= Date.now()) return toast("⚠️ La fecha debe ser futura", "#f97316");
    const dias = Math.max(1, Math.ceil((nuevaExpiry - Date.now()) / 864e5));

    const log = JSON.parse(localStorage.getItem(CAT_LOG_KEY) || "[]");
    const original = log.find(e => e.id === id);
    const receta = original?.receta;

    // Con receta + stock cargado: regenerar con productos que tienen stock hoy
    if (receta && _catFiltrada?.length) {
        try {
            await _clonarConStockActual(original, receta, dias, nuevaExpiry);
        } catch(err) {
            toast("❌ " + err.message, "#ef4444");
        }
        return;
    }

    // Sin stock cargado pero hay receta: avisar
    if (receta && !_catFiltrada?.length) {
        return toast("⚠️ Abre el tab Catálogo y carga el inventario primero para generar con stock actual", "#f97316");
    }

    // Sin receta (catálogos generados antes de esta versión): clonar snapshot desde KV
    try {
        const res = await fetch("/clone-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dias, expiresAt: nuevaExpiry, _pass: ADMIN_PASS })
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || "Error del servidor");
        const nuevaUrl = location.origin + out.url;
        const newEntry = {
            id: out.url.split("/").pop(),
            url: nuevaUrl,
            nombre: original?.nombre || nombre || "Sin nombre",
            nota: original?.nota || "",
            filtros: original?.filtros || [],
            expiry: nuevaExpiry,
            esAfiliado: original?.esAfiliado || false,
            createdAt: Date.now()
        };
        log.unshift(newEntry);
        localStorage.setItem(CAT_LOG_KEY, JSON.stringify(log.slice(0, 50)));
        try { await navigator.clipboard.writeText(nuevaUrl); } catch(_){}
        toast("🔗 Nuevo link generado y copiado", "#22c55e");
        renderLogCatalogos();
    } catch(err) {
        toast("❌ No se pudo generar el link: " + err.message, "#ef4444");
    }
}

async function _clonarConStockActual(original, receta, dias, nuevaExpiry) {
    // Filtrar stock actual por los mismos criterios de la receta original
    let items = [..._catFiltrada];

    if (receta.categorias?.length) {
        items = items.filter(p => receta.categorias.includes(p._catKey || getCatKey(p)));
    }
    if (receta.ocasiones?.length) {
        items = items.filter(p => ocasionesDeProd(p).some(o => receta.ocasiones.includes(o)));
    }
    if (receta.genero === "dama")      items = items.filter(p => !/caballero|hombre/i.test(p.genero || ""));
    if (receta.genero === "caballero") items = items.filter(p => /caballero|hombre/i.test(p.genero || ""));
    if (receta.tipoAN === "pareja")    items = items.filter(p => p._esPareja);
    if (receta.tipoAN === "sencillo")  items = items.filter(p => !p._esPareja && (p._catKey || getCatKey(p)) === "AN");

    // Para anillos: filtrar solo los que tienen al menos una de las tallas pedidas
    if (receta.talla) {
        const tallasReq = receta.talla.split(",").map(t => t.trim()).filter(Boolean);
        if (tallasReq.length) {
            items = items.filter(p => {
                const catKey = p._catKey || getCatKey(p);
                if (catKey !== "AN") return true; // pulseras, cadenas, etc. no filtran por talla
                const todasLasTallas = [...(p._sizes || []), ...(p._sizesD || []), ...(p._sizesH || [])];
                if (!todasLasTallas.length) return true; // sin info de talla → incluir
                return tallasReq.some(t => todasLasTallas.includes(t));
            });
        }
    }

    // Para híbridos: excluir productos que ya tienen físicamente en consignación
    if (receta.afiliadoCodigo) {
        const vHib = _vendedoresAfiliados.find(x => x.codigo === receta.afiliadoCodigo);
        if (vHib?.tipo === "hibrido") {
            try {
                const rFis = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "GET_CODIGOS_FISICOS", vendedor: receta.afiliadoCodigo, _pass: ADMIN_PASS }) });
                const { codigos: codsFis = [] } = await rFis.json();
                if (codsFis.length) {
                    const antes = items.length;
                    items = items.filter(p => !codsFis.includes(p._codigos?.[0] || p.codigo));
                    if (items.length < antes)
                        toast(`ℹ️ ${antes - items.length} producto(s) excluidos del catálogo (ya los tiene físicamente)`, "#0277bd");
                }
            } catch(_) {}
        }
    }

    if (!items.length) throw new Error("No hay productos con stock disponible con esos criterios");

    // Priorizar productos que NO estaban en el catálogo anterior (variedad)
    const anteriores = new Set(receta.ultimosCodigos || []);
    const nuevos = items.filter(p => !anteriores.has(p._codigos?.[0] || p.codigo));
    const pool = nuevos.length >= Math.min(receta.cantidad, items.length) ? nuevos : items;
    const seleccionados = pool.slice(0, receta.cantidad || pool.length);

    const talla = receta.talla || "";
    const genero = receta.genero || "";
    const nuevaReceta = { ...receta, ultimosCodigos: seleccionados.map(p => p._codigos?.[0] || p.codigo) };

    const data = {
        expiry: nuevaExpiry,
        nombre: original.nombre || "",
        talla,
        wa: receta.wa || VEREX_WA_OFICIAL,
        dias,
        receta: nuevaReceta,
        ...(original.nota && { nota_interna: original.nota }),
        ...(original.esAfiliado && { afiliado: true }),
        ...(receta.afiliadoCodigo && { afiliadoCodigo: receta.afiliadoCodigo }),
        // El banner/descuento solo se incluye si el llamador lo pasó explícitamente
        // (ver reactivarLinkPanel) — nunca se reactiva en automático sin preguntar.
        ...(original.banner && { banner: original.banner }),
        ...(original.descPct > 0 && { descPct: original.descPct }),
        ...(original.promoCarrito && { promoCarrito: original.promoCarrito }),
        ...(original.envioGratisDesde > 0 && { envioGratisDesde: original.envioGratisDesde }),
        ...(original.regaloSorpresa && { regaloSorpresa: original.regaloSorpresa }),
        prods: seleccionados.map(p => {
            const szExport = _sizesParaExport(p, talla, genero);
            return {
                n: p.nombre || "—",
                p: parseFloat(p.precio || 0).toFixed(2),
                i: p.foto || p.img || "",
                m: p.material || detectarMaterial(p.nombre) || "",
                cat: p._catKey || getCatKey(p),
                c: p._codigos?.[0] || p.codigo || "",
                sizes: szExport.sizes,
                sizesD: szExport.sizesD,
                sizesH: szExport.sizesH,
                par: p._esPareja || false,
                piezas: p._piezas || (p._esPareja ? 2 : null),
                pD: p._precioDama || null,
                pH: p._precioCab || null,
                cD: p._piezasCodigosDama || null,
                cC: p._piezasCodigosCab || null,
                avisoPieza: /matrimonio|argolla|novios|pareja|alianza/i.test(p.nombre || ""),
                ne: getNotaEspecial(p),
                nota: ""
            };
        })
    };

    const saveRes = await fetch("/save-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, _pass: ADMIN_PASS })
    });
    if (!saveRes.ok) throw new Error("Error al guardar catálogo");
    const { url } = await saveRes.json();
    const nuevaUrl = location.origin + url;

    const log = JSON.parse(localStorage.getItem(CAT_LOG_KEY) || "[]");
    log.unshift({
        id: url.split("/").pop(),
        url: nuevaUrl,
        nombre: original.nombre || "",
        nota: original.nota || "",
        filtros: original.filtros || [],
        expiry: nuevaExpiry,
        esAfiliado: original.esAfiliado || false,
        createdAt: Date.now(),
        receta: nuevaReceta
    });
    localStorage.setItem(CAT_LOG_KEY, JSON.stringify(log.slice(0, 50)));
    try { await navigator.clipboard.writeText(nuevaUrl); } catch(_){}
    toast(`🔗 Nuevo link — ${seleccionados.length} productos con stock actual`, "#22c55e");
    renderLogCatalogos();
}

// Link/QR fijo hacia la página de Garantía Limitada — vive en el dominio
// admin-tienda.pages.dev (independiente de verexstore.com) para que un
// cliente de afiliado pueda consultarla sin terminar en la tienda directa
// de VEREX y sin riesgo de que el afiliado pierda la venta.
const GARANTIA_URL = "https://admin-tienda.pages.dev/garantia.html";
function abrirModalGarantia() {
    document.getElementById("garantia-link-out").textContent = GARANTIA_URL;
    document.getElementById("garantia-qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=" + encodeURIComponent(GARANTIA_URL);
    document.getElementById("garantia-qr-download").href = "https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=" + encodeURIComponent(GARANTIA_URL);
    document.getElementById("modal-garantia").style.display = "flex";
}

// Valores por defecto — deben coincidir con los de garantia.html para que
// el editor muestre lo mismo que ve el cliente antes de la primera edición.
const GARANTIA_DEFAULTS = {
    dias: 30,
    intro: "En VEREX nos comprometemos a ofrecer joyas de alta calidad. Por ello, todas nuestras piezas cuentan con una Garantía Limitada de {dias} días calendario, válida únicamente contra defectos de fabricación.",
    cubre: "- Piedras que se desprendan debido a un defecto en el engaste de fábrica (sin golpe ni mal uso de por medio).\n- Broches o cierres que presenten fallas de fabricación.\n- Soldaduras defectuosas.\n- Desprendimiento del baño (cuando aplique) por defectos de fabricación y bajo condiciones normales de uso.",
    no_cubre: "- Piedras desprendidas por golpes, caídas, jalones o manipulación inadecuada.\n- Cadenas, pulseras, aretes u otras joyas dañadas por enganches, tirones o uso brusco.\n- Rayones, deformaciones o desgaste normal ocasionado por el uso.\n- Oscurecimiento, oxidación o pérdida de brillo de la plata — es una reacción natural del material y puede variar según el pH de la piel, el sudor, perfumes, cremas, cloro, humedad y otros agentes externos. No afecta la calidad ni la autenticidad de la joya, y puede revertirse con una limpieza y mantenimiento adecuados.\n- Daños ocasionados por accidentes, mal uso, almacenamiento inadecuado o reparaciones realizadas por terceros.\n- Pérdida total o parcial de la joya o de cualquiera de sus componentes por causas ajenas a un defecto de fabricación.",
    promo: "Los productos adquiridos con promociones o descuentos no aplican para cambios, devoluciones o reembolsos por decisión del cliente. No obstante, conservan la Garantía Limitada por defectos de fabricación establecida en esta política.\n\nEn productos vendidos como liquidación, saldo, o con un defecto previamente informado y aceptado por el cliente, la garantía no cubrirá la condición específica que motivó el descuento.",
    solicitud: "Comunícate con VEREX dentro del período de garantía a través de nuestros canales oficiales de atención, proporcionando:\n- Número de pedido.\n- Fotografías o videos donde se observe el inconveniente.\n\nVEREX podrá solicitar información adicional cuando sea necesaria para evaluar el caso.",
    evaluacion: "Toda solicitud será evaluada para determinar si el inconveniente corresponde a un defecto de fabricación o a una situación no cubierta por esta política. Si la garantía es aprobada, VEREX podrá, según corresponda:\n- Reparar la joya.\n- Sustituirla por una igual o de características similares.\n- Reemplazarla por otro producto de igual valor cuando la reparación o sustitución no sea posible.\n\nSi se determina que existe un defecto de fabricación, VEREX asumirá los costos de envío relacionados con la garantía. En caso contrario, cualquier costo de envío será responsabilidad del cliente.",
    destacado: "Válida solo en canales oficiales VEREX. Esta Garantía Limitada aplica únicamente a productos adquiridos directamente a través de los canales oficiales de VEREX, y podrá hacerse efectiva utilizando el número de pedido registrado en nuestro sistema. VEREX se reserva el derecho de rechazar solicitudes cuando no sea posible verificar el origen de la compra."
};

async function abrirEditorGarantia() {
    document.getElementById("modal-garantia-editor").style.display = "flex";
    let g = null;
    try {
        const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_GARANTIA", _pass: ADMIN_PASS }) });
        const data = await res.json();
        g = data.garantia;
    } catch(e) { toast("⚠️ No se pudo cargar el contenido actual, mostrando valores por defecto","#f97316"); }
    const c = { ...GARANTIA_DEFAULTS, ...(g||{}) };
    document.getElementById("ge-dias").value       = c.dias;
    document.getElementById("ge-intro").value      = c.intro;
    document.getElementById("ge-cubre").value      = c.cubre;
    document.getElementById("ge-no-cubre").value   = c.no_cubre;
    document.getElementById("ge-promo").value      = c.promo;
    document.getElementById("ge-solicitud").value  = c.solicitud;
    document.getElementById("ge-evaluacion").value = c.evaluacion;
    document.getElementById("ge-destacado").value  = c.destacado;
}

async function guardarEditorGarantia() {
    const btn = document.getElementById("btn-ge-guardar");
    btn.textContent = "⏳ Guardando..."; btn.disabled = true;
    try {
        await fetch(API_URL, { method:'POST', body: JSON.stringify({
            accion: "GUARDAR_GARANTIA", _pass: ADMIN_PASS,
            dias:       document.getElementById("ge-dias").value,
            intro:      document.getElementById("ge-intro").value,
            cubre:      document.getElementById("ge-cubre").value,
            no_cubre:   document.getElementById("ge-no-cubre").value,
            promo:      document.getElementById("ge-promo").value,
            solicitud:  document.getElementById("ge-solicitud").value,
            evaluacion: document.getElementById("ge-evaluacion").value,
            destacado:  document.getElementById("ge-destacado").value,
        })});
        toast("✅ Página de Garantía actualizada","#22c55e");
        document.getElementById("modal-garantia-editor").style.display = "none";
    } catch(e) {
        toast("❌ Error al guardar: " + e.message, "#ef4444");
    }
    btn.textContent = "💾 Guardar y publicar"; btn.disabled = false;
}

// Link/QR de la Política de Cambios — página APARTE de Garantía (el cliente
// no debe confundir "quiero cambiar de talla/diseño" con "tengo un defecto
// de fabricación", son procesos y costos distintos).
const CAMBIOS_URL = "https://admin-tienda.pages.dev/cambios.html";
function abrirModalCambios() {
    document.getElementById("cambios-link-out").textContent = CAMBIOS_URL;
    document.getElementById("cambios-qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=" + encodeURIComponent(CAMBIOS_URL);
    document.getElementById("cambios-qr-download").href = "https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=" + encodeURIComponent(CAMBIOS_URL);
    document.getElementById("modal-cambios").style.display = "flex";
}

const CAMBIOS_DEFAULTS = {
    texto: "En VEREX queremos que estés completamente conforme con tu compra. Si deseas cambiar tu producto por otro (talla, diseño o modelo), sigue estos pasos:\n\n1. Contáctanos primero. Escríbenos por WhatsApp dentro de los 3 días después de recibir tu pedido, indicando el número de pedido y el motivo del cambio.\n\n2. Condición del producto. El producto debe estar sin uso, en las mismas condiciones en que lo recibiste y, de ser posible, en su empaque original.\n\n3. Envíanos el producto. Una vez confirmado el cambio, envíalo por la agencia de tu preferencia. El costo de este primer envío corre por cuenta del cliente.\n\n4. Coordinamos el reenvío. Al recibir tu producto, te contactamos para coordinar el envío del nuevo. El costo del reenvío es de $5.00.\n\n5. Diferencia de precio. Si el nuevo producto tiene un precio distinto al original, se cobra la diferencia.\n\nCon gusto estaremos pendientes para ayudarte con todo el proceso.",
    costoReenvio: 5
};

async function abrirEditorCambios() {
    document.getElementById("modal-cambios-editor").style.display = "flex";
    let cm = null;
    try {
        const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"GET_CAMBIOS", _pass: ADMIN_PASS }) });
        const data = await res.json();
        cm = data.cambios;
    } catch(e) { toast("⚠️ No se pudo cargar el contenido actual, mostrando valores por defecto","#f97316"); }
    const c = { ...CAMBIOS_DEFAULTS, ...(cm||{}) };
    document.getElementById("ce-costo").value = c.costoReenvio;
    document.getElementById("ce-texto").value = c.texto;
}

async function guardarEditorCambios() {
    const btn = document.getElementById("btn-ce-guardar");
    btn.textContent = "⏳ Guardando..."; btn.disabled = true;
    try {
        await fetch(API_URL, { method:'POST', body: JSON.stringify({
            accion: "GUARDAR_CAMBIOS", _pass: ADMIN_PASS,
            costoReenvio: document.getElementById("ce-costo").value,
            texto:        document.getElementById("ce-texto").value,
        })});
        toast("✅ Página de Política de Cambios actualizada","#22c55e");
        document.getElementById("modal-cambios-editor").style.display = "none";
    } catch(e) {
        toast("❌ Error al guardar: " + e.message, "#ef4444");
    }
    btn.textContent = "💾 Guardar y publicar"; btn.disabled = false;
}

async function desactivarLinkCatalogo(linkOrId) {
    const raw = (linkOrId||"").trim();
    if (!raw) return toast("⚠️ Pega el link o código a desactivar","#f97316");
    // Acepta URL completa (.../c/abc123) o solo el código
    const m = raw.match(/\/c\/([a-z0-9-]+)/i);
    const id = m ? m[1] : raw.replace(/[^a-z0-9-]/gi,"");
    if (!id) return toast("⚠️ No se pudo leer el código del link","#f97316");
    if (!confirm(`¿Desactivar el catálogo "${id}"? El link dejará de funcionar de inmediato.`)) return;

    try {
        const res = await fetch("/deactivate-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, _pass: ADMIN_PASS })
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || "No se pudo desactivar");
        toast("🚫 Link desactivado","#22c55e");
        if (document.getElementById("lk-lista")) cargarPanelLinks();
    } catch(e) {
        console.error(e);
        toast("❌ Error: "+e.message,"#ef4444");
    }
}

// Botón ⏱️ de la pestaña Links (antes vivía en «Gestión de links anteriores» del modal).
function cambiarVigenciaLinkPanel(url) {
    const dias = parseInt(prompt("¿Cuántos días más debe estar activo este link (desde hoy)?", "7"));
    if (!dias || dias < 1) return;
    editarVigenciaCatalogo(url, Math.min(dias, 90));
}

// Cambia cuánto le queda de vida a un link YA generado, sin desactivarlo ni
// tener que mandar uno nuevo — útil cuando se te olvidó limitar la vigencia
// o quieres darle más tiempo del que pusiste originalmente.
async function editarVigenciaCatalogo(linkOrId, dias) {
    const raw = (linkOrId||"").trim();
    if (!raw) return toast("⚠️ Pega el link o código a editar","#f97316");
    const m = raw.match(/\/c\/([a-z0-9-]+)/i);
    const id = m ? m[1] : raw.replace(/[^a-z0-9-]/gi,"");
    if (!id) return toast("⚠️ No se pudo leer el código del link","#f97316");
    if (!confirm(`¿Actualizar la vigencia del catálogo "${id}" a ${dias} día(s) desde ahora?`)) return;

    try {
        const res = await fetch("/edit-catalog-expiry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, dias: parseInt(dias), _pass: ADMIN_PASS })
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || "No se pudo actualizar");
        toast(`✅ Vigencia actualizada — ${dias} día(s) desde ahora`,"#22c55e");
        if (document.getElementById("lk-lista")) cargarPanelLinks();
    } catch(e) {
        console.error(e);
        toast("❌ Error: "+e.message,"#ef4444");
    }
}
