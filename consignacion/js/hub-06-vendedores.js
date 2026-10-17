// Hub VEREX — Lista de vendedores, estadísticas, catálogo del perfil y leads del vendedor
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
function renderVendedores() {
    const grid = document.getElementById("grid-vendedores");
    grid.innerHTML = vendedores.map(v => {
        const inv = consignacion.filter(c => c.vendedor === v.codigo && c.estado === "activo");
        const stock = inv.reduce((s, c) => s + (parseInt(c.cantidad) - parseInt(c.vendido||0)), 0);
        // Comisión acumulada en vivo — mismo cálculo exacto que "Hacer Corte",
        // así el número siempre calza con lo que saldría al cortar ahora mismo.
        let comisionLive = 0, comisionPct = 0;
        if (v.tipo === "afiliado" || v.tipo === "hibrido") {
            const valorVendCard = inv.reduce((s, c) => s + parseInt(c.vendido||0) * parseFloat(c.precio||0), 0);
            comisionPct  = calcularComision(valorVendCard, v.tipo, v.comisionFija);
            comisionLive = valorVendCard * comisionPct / 100;
        }
        const inicial = sanitizar((v.nombre || "?")[0].toUpperCase());
        const leadsPend = leadsData.filter(l => l.afiliado === v.codigo && (l.estado === "interesado" || l.estado === "reportado")).length;
        const inactivo = v.activo === false;
        return `<div class="vendedor-card" onclick="abrirPerfil(${jsArg(v.codigo)})" style="position:relative;${inactivo?'opacity:.5;':''}">
            <button onclick="event.stopPropagation();toggleMenuVendedor('menu-${sanitizar(v.codigo)}')"
                style="position:absolute;top:8px;right:8px;background:var(--gris);border:none;color:var(--plateado);border-radius:50%;width:26px;height:26px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2;">⋯</button>
            <div id="menu-${sanitizar(v.codigo)}" style="display:none;position:absolute;top:36px;right:8px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;z-index:10;min-width:150px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
                <button onclick="event.stopPropagation();toggleActivoVendedor(${jsArg(v.codigo)})"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:${inactivo?'#27ae60':'#C9A84C'};font-size:13px;cursor:pointer;text-align:left;border-bottom:1px solid var(--borde);">${inactivo?'✅ Activar':'⏸️ Desactivar'}</button>
                <button onclick="event.stopPropagation();eliminarVendedor(${jsArg(v.codigo)},${jsArg(v.nombre)})"
                    style="width:100%;padding:10px 14px;background:none;border:none;color:#e74c3c;font-size:13px;cursor:pointer;text-align:left;">🗑️ Eliminar</button>
            </div>
            <div style="position:relative;width:54px;margin:0 auto 10px;">
                <div class="vendedor-avatar" onclick="${leadsPend > 0 ? `event.stopPropagation();abrirLeadsVendedor(${jsArg(v.codigo)})` : ''}" title="${leadsPend > 0 ? leadsPend + ' Lead(s) pendientes de confirmar — toca para verlos' : 'Sin Leads pendientes'}" style="margin:0;${leadsPend > 0 ? 'background:#16a34a;color:#fff;cursor:pointer;box-shadow:0 0 0 3px rgba(22,163,74,.35);' : ''}">${inicial}</div>
                <div onclick="event.stopPropagation();abrirLeadsVendedor(${jsArg(v.codigo)})" title="${leadsPend} Lead(s) pendientes" style="position:absolute;top:-4px;right:-4px;background:#111;color:${leadsPend > 0 ? '#4ade80' : 'var(--dorado)'};border:2px solid ${leadsPend > 0 ? '#16a34a' : 'var(--dorado)'};border-radius:50%;width:20px;height:20px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer;">${leadsPend}</div>
            </div>
            <div class="vendedor-nombre">${sanitizar(v.nombre)}</div>
            <div style="font-size:10px;color:var(--dorado);font-weight:600;letter-spacing:1px;margin-bottom:2px;">${sanitizar(v.codigo)}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-bottom:4px;">
                ${v.tipo === "afiliado"
                    ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.35);border-radius:5px;padding:1px 6px;">🤝 AFILIADO</div>'
                    : v.tipo === "hibrido"
                    ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#a78bfa;background:rgba(167,139,250,0.15);border:1px solid rgba(167,139,250,0.35);border-radius:5px;padding:1px 6px;">🔄 HÍBRIDO</div>'
                    : ''}
                ${(v.tipo === "afiliado" && v.recibeFisico) || v.tipo === "hibrido"
                    ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#C9A84C;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.35);border-radius:5px;padding:1px 6px;">📦 RECIBE PIEZAS</div>'
                    : ''}
                ${inactivo ? '<div style="display:inline-block;font-size:9px;font-weight:700;color:#888;background:rgba(136,136,136,0.15);border:1px solid rgba(136,136,136,0.35);border-radius:5px;padding:1px 6px;">⏸️ INACTIVO</div>' : ''}
                ${v.comisionFija !== undefined && v.comisionFija !== null ? `<div style="display:inline-block;font-size:9px;font-weight:700;color:#0277bd;background:rgba(2,119,189,0.15);border:1px solid rgba(2,119,189,0.35);border-radius:5px;padding:1px 6px;">${v.comisionFija}% fija</div>` : ''}
            </div>
            <div class="vendedor-stock">${stock} piezas</div>
            ${_proximoCorteCardHTML(v)}
            ${(v.tipo === "afiliado" || v.tipo === "hibrido") ? `<div style="font-size:11px;font-weight:700;color:#27ae60;margin-top:2px;" title="Comisión acumulada sin cortar">💰 $${comisionLive.toFixed(2)} <span style="color:var(--plateado);font-weight:400;">(${comisionPct}%)</span></div>` : ''}
        </div>`;
    }).join('') + `<button class="btn-nuevo-vendedor" onclick="abrirModalVendedor()">+ Nuevo Vendedor</button>`;
}

const ADMIN_CAT_URL = "https://admin-tienda.pages.dev";

async function _cargarStatsAfiliados(codigos) {
    await Promise.all(codigos.map(async codigo => {
        const el = document.getElementById("cat-stats-" + codigo);
        if (!el) return;
        try {
            const res = await fetch(ADMIN_CAT_URL + "/affiliate-stats", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ afiliadoCodigo: codigo })
            });
            if (!res.ok) { el.innerHTML = ""; return; }
            const { totalCatalogos, totalVistas, ultimaVista, catalogoActivo } = await res.json();

            if (!totalCatalogos && !catalogoActivo) {
                el.innerHTML = `<div style="font-size:10px;color:#555;text-align:center;">Sin catálogos generados</div>`;
                return;
            }

            const ultimaTotal = ultimaVista ? _catTiempoRelativo(ultimaVista) : "—";
            let html = "";

            if (catalogoActivo) {
                const vence = new Date(catalogoActivo.expiresAt).toLocaleDateString("es-SV", { day:"numeric", month:"short" });
                const ultimaCat = catalogoActivo.ultimaVista ? _catTiempoRelativo(catalogoActivo.ultimaVista) : null;
                const primeraApertura = catalogoActivo.primeraVista
                    ? new Date(catalogoActivo.primeraVista).toLocaleDateString("es-SV", { day:"numeric", month:"short" })
                    : null;

                html += `<div style="background:#0d1f0d;border:1px solid #1a3a1a;border-radius:8px;padding:7px 9px;margin-bottom:4px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-size:10px;font-weight:700;color:#4ade80;">🔗 Catálogo activo</span>
                        <span style="font-size:9px;color:#555;">vence ${vence}</span>
                    </div>
                    <div style="font-size:10px;color:#86efac;word-break:break-all;margin-bottom:5px;">${catalogoActivo.url}</div>
                    <div style="display:flex;gap:5px;margin-bottom:5px;">
                        <button onclick="navigator.clipboard.writeText('${catalogoActivo.url}');toast('✅ Link copiado','#22c55e')"
                            style="flex:1;font-size:10px;background:#166534;color:#fff;border:none;border-radius:5px;padding:4px 0;cursor:pointer;font-weight:600;">📋 Copiar</button>
                        <button onclick="window.open('${catalogoActivo.url}','_blank')"
                            style="font-size:10px;background:#1a3a1a;color:#86efac;border:1px solid #1a3a1a;border-radius:5px;padding:4px 8px;cursor:pointer;">👁️ Ver</button>
                        <button onclick="window.open('https://wa.me/?text='+encodeURIComponent('Hola, aquí está tu catálogo VEREX: ${catalogoActivo.url}'),'_blank')"
                            style="font-size:10px;background:#14532d;color:#4ade80;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;">📱</button>
                    </div>
                    <div style="font-size:10px;color:#6b7280;">
                        👁️ <b style="color:#d1fae5">${catalogoActivo.vistas}</b> ${catalogoActivo.vistas === 1 ? "apertura" : "aperturas"}
                        ${primeraApertura ? ` · primera: ${primeraApertura}` : ""}
                        ${ultimaCat ? ` · última: ${ultimaCat}` : " · aún no abierto"}
                        &nbsp;·&nbsp; ${catalogoActivo.prods} productos
                    </div>
                </div>`;
            } else {
                html += `<div style="font-size:10px;color:#555;text-align:center;margin-bottom:4px;">Sin catálogo activo</div>`;
            }

            if (totalCatalogos > 0) {
                html += `<div style="font-size:10px;color:#6b7280;text-align:center;">
                    📊 Total histórico: <b style="color:#9ca3af">${totalVistas}</b> vistas en ${totalCatalogos} catálogo${totalCatalogos !== 1 ? "s" : ""}
                    ${ultimaVista ? ` · última: ${ultimaTotal}` : ""}
                </div>`;
            }

            el.innerHTML = html;
        } catch(_) { el.innerHTML = ""; }
    }));
}

async function _cargarCatalogoPerfil(codigo) {
    const wrap = document.getElementById("perfil-catalogo-contenido");
    if (!wrap) return;
    wrap.innerHTML = '<p style="color:var(--plateado);font-size:13px;">⏳ Cargando...</p>';
    try {
        const res = await fetch(ADMIN_CAT_URL + "/affiliate-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ afiliadoCodigo: codigo })
        });
        if (!res.ok) throw new Error("Sin respuesta");
        const { totalCatalogos, totalVistas, ultimaVista, catalogos } = await res.json();

        if (!catalogos?.length) {
            wrap.innerHTML = `<p style="color:var(--plateado);font-size:13px;">No hay catálogos generados para este afiliado.<br><span style="font-size:11px;">Genera el primero desde el Admin → tab Catálogo.</span></p>`;
            return;
        }

        // Resumen total
        const ultimaTxt = ultimaVista ? _catTiempoRelativo(ultimaVista) : "—";
        let html = `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
            <div style="flex:1;min-width:80px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#fff;">${totalCatalogos}</div>
                <div style="font-size:10px;color:var(--plateado);">catálogos</div>
            </div>
            <div style="flex:1;min-width:80px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:8px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#4ade80;">${totalVistas}</div>
                <div style="font-size:10px;color:var(--plateado);">vistas totales</div>
            </div>
            <div style="flex:1;min-width:80px;background:var(--gris2);border:1px solid var(--borde);border-radius:8px;padding:8px;text-align:center;">
                <div style="font-size:13px;font-weight:700;color:#C9A84C;">${ultimaTxt}</div>
                <div style="font-size:10px;color:var(--plateado);">última apertura</div>
            </div>
        </div>`;

        // Lista de catálogos del más reciente al más antiguo
        html += catalogos.map(cat => {
            const fechaGen  = cat.createdAt  ? new Date(cat.createdAt).toLocaleDateString("es-SV",  { day:"numeric", month:"short", year:"numeric" }) : "—";
            const fechaVence = cat.expiresAt ? new Date(cat.expiresAt).toLocaleDateString("es-SV",  { day:"numeric", month:"short" }) : "—";
            const primera   = cat.primeraVista ? new Date(cat.primeraVista).toLocaleDateString("es-SV", { day:"numeric", month:"short" }) : null;
            const ultima    = cat.ultimaVista   ? _catTiempoRelativo(cat.ultimaVista) : null;
            const borderColor = cat.activo ? "#16a34a" : "#374151";
            const statusBadge = cat.activo
                ? `<span style="font-size:10px;background:#14532d;color:#4ade80;border-radius:5px;padding:2px 7px;font-weight:700;">● ACTIVO</span>`
                : `<span style="font-size:10px;background:#1f2937;color:#6b7280;border-radius:5px;padding:2px 7px;">✕ Vencido</span>`;

            return `<div style="border:1px solid ${borderColor};border-radius:10px;padding:12px;margin-bottom:10px;background:var(--gris2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
                    <div>
                        <div style="font-size:12px;font-weight:700;color:#fff;">${cat.nombre || "(Sin nombre)"}</div>
                        <div style="font-size:10px;color:var(--plateado);">Generado: ${fechaGen} · vence: ${fechaVence} · ${cat.prods} productos</div>
                    </div>
                    ${statusBadge}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
                    <div style="background:#111;border-radius:7px;padding:7px;text-align:center;">
                        <div style="font-size:18px;font-weight:700;color:#4ade80;">${cat.vistas}</div>
                        <div style="font-size:9px;color:var(--plateado);">${cat.vistas === 1 ? "apertura" : "aperturas"}</div>
                    </div>
                    <div style="background:#111;border-radius:7px;padding:7px;text-align:center;">
                        <div style="font-size:12px;font-weight:700;color:#C9A84C;">${primera || "—"}</div>
                        <div style="font-size:9px;color:var(--plateado);">primera vista</div>
                    </div>
                    <div style="background:#111;border-radius:7px;padding:7px;text-align:center;">
                        <div style="font-size:12px;font-weight:700;color:#C9A84C;">${ultima || "—"}</div>
                        <div style="font-size:9px;color:var(--plateado);">última vista</div>
                    </div>
                </div>
                ${cat.vistas === 0 ? `<div style="font-size:11px;color:#6b7280;text-align:center;padding:4px 0;">Este catálogo nunca fue abierto</div>` : ""}
                <div style="display:flex;gap:6px;">
                    <button onclick="navigator.clipboard.writeText('${cat.url}');toast('✅ Link copiado','#22c55e')"
                        style="flex:1;font-size:11px;background:#166534;color:#fff;border:none;border-radius:7px;padding:7px 0;cursor:pointer;font-weight:600;">📋 Copiar link</button>
                    <button onclick="window.open('${cat.url}','_blank')"
                        style="font-size:11px;background:#1a3a1a;color:#86efac;border:1px solid #1a3a1a;border-radius:7px;padding:7px 10px;cursor:pointer;">👁️ Ver</button>
                    <button onclick="window.open('https://wa.me/?text='+encodeURIComponent('Hola, aquí está tu catálogo VEREX: ${cat.url}'),'_blank')"
                        style="font-size:11px;background:#14532d;color:#4ade80;border:none;border-radius:7px;padding:7px 10px;cursor:pointer;">📱</button>
                </div>
            </div>`;
        }).join("");

        wrap.innerHTML = html;
    } catch(_) {
        wrap.innerHTML = `<p style="color:var(--plateado);font-size:13px;">No se pudieron cargar las métricas. Verifica tu conexión.</p>`;
    }
}

function _catTiempoRelativo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const dias = Math.floor(diff / 86400000);
    if (min < 2)  return "ahora";
    if (min < 60) return `hace ${min}min`;
    if (hrs < 24) return `hace ${hrs}h`;
    if (dias < 7) return `hace ${dias}d`;
    return new Date(ts).toLocaleDateString("es-SV", { day:"numeric", month:"short" });
}

const LEAD_ESTADO_INFO = {
    interesado: { label: "🔵 Interesado",  color: "#4a90d9" },
    reportado:  { label: "🟡 Reportado — pendiente de confirmar", color: "#C9A84C" },
    en_camino:  { label: "🚚 En camino — pendiente de entrega",   color: "#f97316" },
    vendido:    { label: "✅ Vendido",      color: "#27ae60" },
    rechazado:  { label: "❌ Rechazado en puerta", color: "#e74c3c" },
    cancelado:  { label: "❌ Cancelado",    color: "#888" },
};

function abrirLeadsVendedor(codigo) {
    const v = vendedores.find(x => x.codigo === codigo);
    document.getElementById("leads-titulo").textContent = "🔔 Leads — " + (v?.nombre || codigo);
    renderLeadsModal(codigo);
    abrirModal("modal-leads");
}

function renderLeadsModal(codigo) {
    const propios = leadsData
        .filter(l => l.afiliado === codigo)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const cont = document.getElementById("leads-lista");
    if (!propios.length) {
        cont.innerHTML = '<p style="color:var(--plateado);font-size:13px;">Sin Leads registrados.</p>';
        return;
    }
    cont.innerHTML = propios.map(l => {
        const info = LEAD_ESTADO_INFO[l.estado] || LEAD_ESTADO_INFO.interesado;
        const fecha = l.fecha ? new Date(l.fecha).toLocaleDateString("es-SV", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "";
        const accionable = l.estado === "interesado" || l.estado === "reportado";
        const enCamino = l.estado === "en_camino";
        const c = l.cliente;
        const casilla = (label, valor) => `<div style="background:var(--negro);border:1px solid var(--borde);border-radius:7px;padding:6px 9px;margin-bottom:5px;">
                <div style="font-size:9px;color:var(--plateado);font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:1px;">${label}</div>
                <div style="font-size:12px;font-weight:600;">${valor}</div>
            </div>`;
        const clienteHtml = c ? `<div style="margin-top:6px;font-size:11px;line-height:1.7;">
                <div style="display:inline-block;background:#16a34a;color:#fff;font-weight:800;font-size:12px;padding:5px 12px;border-radius:20px;margin-bottom:6px;">✅ Pedido completado por el afiliado</div>
                ${casilla("Nombre del cliente", sanitizar(c.nombre))}
                ${casilla("Teléfono", sanitizar(c.telefono))}
                ${casilla("Dirección", `${sanitizar(c.direccion)}, ${sanitizar(c.municipio)}, ${sanitizar(c.departamento)}`)}
                <div style="padding:6px 9px;">💵 Contra entrega en efectivo${l.envioInfo ? ` · Envío: ${l.envioInfo.envio===0?'GRATIS':'$'+l.envioInfo.envio.toFixed(2)} · Total: $${l.envioInfo.total.toFixed(2)}` : ''}</div>
            </div>` : '';
        return `<div style="padding:10px 12px;background:var(--gris2);border:1px solid var(--borde);border-radius:10px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
                ${l.foto ? `<img src="${sanitizar(ikFoto(l.foto,120))}" onerror="this.style.display='none'" onclick="verStockLead('${sanitizar(l.id)}','${sanitizar(l.codigo)}')" title="Ver stock y confirmar" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0;cursor:pointer;">` : ''}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;">${sanitizar(l.nombre||l.codigo)}</div>
                    <div style="font-size:11px;color:var(--plateado);">$${parseFloat(l.precio||0).toFixed(2)} · ${fecha}</div>
                    <div style="font-size:11px;font-weight:600;color:${info.color};margin-top:2px;">${info.label}</div>
                    <div style="font-size:10px;color:var(--dorado);margin-top:2px;cursor:pointer;text-decoration:underline;" onclick="verStockLead('${sanitizar(l.id)}','${sanitizar(l.codigo)}')">🔎 ${sanitizar(l.codigo)} — ver stock y confirmar</div>
                </div>
                ${accionable ? `<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                    <button onclick="confirmarLeadEnvio('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#f97316;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">📦 Empacar y Enviar</button>
                    <button onclick="cancelarLeadUI('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">❌ Cancelar</button>
                </div>` : ''}
                ${enCamino ? `<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;position:relative;">
                    <div style="display:flex;gap:2px;">
                        <button onclick="confirmarLeadEntrega('${sanitizar(l.id)}',false)" style="flex:1;padding:5px 8px;font-size:11px;background:#27ae60;color:#fff;border:none;border-radius:6px 0 0 6px;cursor:pointer;font-weight:600;">✅ Confirmar Entrega</button>
                        <button onclick="event.stopPropagation();toggleMenuCambio('${sanitizar(l.id)}',this)" title="Otras opciones" style="padding:5px 6px;font-size:11px;background:#1e6b3e;color:#fff;border:none;border-radius:0 6px 6px 0;cursor:pointer;font-weight:700;border-left:1px solid rgba(255,255,255,.25);">▾</button>
                    </div>
                    <div id="menu-cambio-${sanitizar(l.id)}" style="display:none;position:absolute;top:32px;right:0;background:#1e1e1e;border:1px solid #444;border-radius:8px;overflow:hidden;z-index:99;min-width:190px;box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                        <button onclick="event.stopPropagation();confirmarLeadEntrega('${sanitizar(l.id)}',true);document.getElementById('menu-cambio-${sanitizar(l.id)}').style.display='none';" style="display:block;width:100%;padding:9px 12px;font-size:11px;background:none;color:#a78bfa;border:none;cursor:pointer;text-align:left;font-weight:600;">🔄 Es un cambio (sin comisión)</button>
                    </div>
                    <button onclick="rechazarLeadEntrega('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">❌ Rechazado en puerta</button>
                </div>` : ''}
                ${(l.estado === "vendido" || l.estado === "en_camino") ? `<button onclick="reimprimirReciboLead('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#111;border:1px solid var(--dorado);color:var(--dorado);border-radius:6px;cursor:pointer;font-weight:600;flex-shrink:0;">🧾 Recibo</button>` : ''}
                ${l.estado === "vendido" ? `<button onclick="cambiarProductoLeadUI('${sanitizar(l.id)}')" style="padding:5px 10px;font-size:11px;background:#8b5cf6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;flex-shrink:0;">🔄 Cambio</button>` : ''}
            </div>
            ${clienteHtml}
        </div>`;
    }).join('');
}

// Muestra un resumen rápido del stock del producto de este Lead (talla,
// ubicación, disponibilidad) con el botón de Confirmar justo ahí — es el
// paso exacto para verificar que existe la pieza y descontarla, sin salir
// del modal de Leads ni ir y volver a la pestaña Stock.
let _leadStockActual = null;
async function verStockLead(id, codigo) {
    _leadStockActual = id;
    const cont = document.getElementById("lead-stock-resumen");
    cont.innerHTML = '<p style="color:var(--plateado);font-size:13px;text-align:center;padding:20px;">⏳ Buscando...</p>';
    abrirModal("modal-lead-stock");

    if (!codigo) { cont.innerHTML = '<p style="color:#e74c3c;font-size:13px;">Este Lead no tiene código de producto.</p>'; return; }
    if (!stockData || !stockData.length) {
        try { const res = await apiPost({ accion: "GET_STOCK" }); stockData = res.stock || []; } catch(_) { stockData = []; }
    }
    const s = stockData.find(p => p.codigo === codigo);
    if (!s) {
        cont.innerHTML = `<p style="color:#e74c3c;font-size:13px;">⚠️ El código <b>${sanitizar(codigo)}</b> ya no existe en Stock — puede haberse eliminado.</p>`;
        return;
    }
    const bodega = parseInt(s.stock_bodega)||0, tienda = parseInt(s.stock_tienda)||0;
    const disponible = bodega + tienda;
    cont.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">
            ${s.foto ? `<img src="${sanitizar(ikFoto(s.foto,160))}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;">` : ''}
            <div>
                <div style="font-weight:700;font-size:14px;">${sanitizar(s.nombre||codigo)}</div>
                <div style="font-size:11px;color:var(--plateado);">${sanitizar(codigo)}${s.talla?` · Talla ${sanitizar(s.talla)}`:''}</div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
            <div class="stat-box"><div class="stat-num" style="font-size:18px;">${bodega}</div><div class="stat-label">Bodega</div></div>
            <div class="stat-box"><div class="stat-num" style="font-size:18px;">${tienda}</div><div class="stat-label">Tienda</div></div>
        </div>
        ${disponible > 0
            ? `<div style="background:rgba(39,174,96,0.15);border:1px solid #27ae60;color:#27ae60;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:14px;">✅ Disponible (${disponible} en total) — lista para confirmar</div>`
            : `<div style="background:rgba(231,76,60,0.15);border:1px solid #e74c3c;color:#e74c3c;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:14px;">⚠️ Sin stock disponible — no se podrá confirmar hasta reponer</div>`
        }
        <button class="btn btn-dorado btn-full" ${disponible<=0?'disabled':''} onclick="confirmarDesdeResumenStock()">📦 Empacar y enviar (reservar stock)</button>
    `;
}

async function confirmarDesdeResumenStock() {
    if (!_leadStockActual) return;
    cerrarModal("modal-lead-stock");
    await confirmarLeadEnvio(_leadStockActual);
    _leadStockActual = null;
}

// Reimprime el recibo de un Lead que ya se confirmó como vendido antes de
// que existiera esta función — los datos del cliente y el producto siguen
// guardados en el Lead, así que se puede generar en cualquier momento.
// Cambio de producto DESPUÉS de entregado (talla que no quedó, defecto, o
// cualquier otro motivo) — la venta y la comisión ya quedaron cerradas al
// confirmar la entrega, esto solo ajusta el inventario físico: regresa la
// pieza vieja a bodega y descuenta la nueva, sin tocar el monto de la venta.
async function cambiarProductoLeadUI(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;
    const codigoNuevo = prompt(
        `Cambio de producto para "${lead.nombre || lead.codigo}".\n\nCódigo EXACTO del producto/talla que se va a enviar en su lugar:`,
        ""
    );
    if (!codigoNuevo || !codigoNuevo.trim()) return;
    const motivo = prompt("Motivo del cambio (opcional, ej: talla no quedó, pieza defectuosa):", "") || "";
    const res = await apiPost({ accion: "CAMBIAR_PRODUCTO_LEAD", id, codigoNuevo: codigoNuevo.trim().toUpperCase(), motivo });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo registrar el cambio")); return; }
    toast("🔄 Cambio registrado — venta y comisión sin alterar");
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

async function reimprimirReciboLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return toast("⚠️ Lead no encontrado");
    const codigoConfirmado = lead.codigoConfirmado || lead.codigo;
    await generarReciboLeadPDF(lead, codigoConfirmado);
}

// Paso 1 de 2: empacar y entregar al transportista — reserva el stock (evita
// que se venda dos veces) pero NO cierra la venta todavía. La venta se cierra
// de verdad hasta que se confirme la entrega real (confirmarLeadEntrega), ya
// que con pago contra entrega el cliente puede rechazar el pedido en la puerta.
async function confirmarLeadEnvio(id) {
    const lead = leadsData.find(l => l.id === id);
    let codigoOverride = null;
    // Los diseños de pareja (dama+caballero) se agrupan en el catálogo bajo un solo
    // código elegido al azar — al confirmar, hay que verificar cuál pieza fue la real.
    const esPareja = /matrimonio|argolla|novios|pareja|alianza/i.test(lead?.nombre || "");
    if (esPareja) {
        const nuevo = prompt(
            "Este es un diseño de pareja (dama/caballero) — el código pudo quedar ambiguo al agrupar el catálogo.\n\n" +
            "Verifica o corrige el código EXACTO de la pieza que realmente se va a enviar (dama o caballero) antes de reservar stock:",
            lead?.codigo || ""
        );
        if (nuevo === null) return; // canceló
        codigoOverride = nuevo.trim();
        if (!codigoOverride) { toast("⚠️ Código vacío — cancelado"); return; }
    }
    const res = await apiPost({ accion: "CONFIRMAR_LEAD_ENVIO", id, codigoOverride });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo confirmar")); return; }
    toast("📦 Pedido en camino — stock reservado. Confirma la entrega cuando el transportista la realice.");
    // El recibo se imprime AQUÍ, al empacar — es lo que va físicamente con el
    // pedido o se le entrega al transportista, no después de la entrega (que
    // pasa a distancia y ya no hay nada que meter en el paquete).
    if (lead) await generarReciboLeadPDF(lead, codigoOverride || lead.codigo);
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Paso 2 de 2 (caso A): el transportista SÍ entregó y cobró — recién aquí se
// cierra la venta de verdad (comisión, Historial de Ventas y recibo).
// Botón "Entregado" = venta normal, un clic, sin preguntar nada (caso de
// siempre). El "▾" al lado abre un menú chiquito con la opción de marcarlo
// como cambio — los cambios son la excepción, no vale la pena interrumpir
// cada confirmación normal con una pregunta.
function toggleMenuCambio(id, btn) {
    document.querySelectorAll('[id^="menu-cambio-"]').forEach(m => {
        if (m.id !== `menu-cambio-${id}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-cambio-${id}`);
    if (!menu) return;
    menu.style.display = menu.style.display === "none" ? "block" : "none";
    if (menu.style.display === "block") {
        setTimeout(() => {
            document.addEventListener("click", function cerrar() {
                menu.style.display = "none";
                document.removeEventListener("click", cerrar);
            }, { once: true });
        }, 10);
    }
}

async function confirmarLeadEntrega(id, esCambio) {
    const lead = leadsData.find(l => l.id === id);
    // Si este envío es el reemplazo de un "🔄 Cambio" ya registrado en OTRO
    // Lead (venta original ya cobrada), no debe sumar venta ni comisión de
    // nuevo — solo se descuenta el stock, porque la pieza sí salió físicamente.
    const res = await apiPost({ accion: "CONFIRMAR_LEAD_ENTREGA", id, esCambio: !!esCambio });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo confirmar la entrega")); return; }
    toast(esCambio ? "✅ Cambio entregado — no se generó venta ni comisión nueva" : "✅ Entrega confirmada — venta y comisión cerradas");
    // El recibo ya se imprimió al empacar (confirmarLeadEnvio) — aquí no se
    // reimprime solo, usa el botón "🧾 Recibo" si necesitas otra copia.
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Paso 2 de 2 (caso B): el cliente rechazó el pedido en la puerta — la pieza
// regresa a bodega, sin generar venta ni comisión.
async function rechazarLeadEntrega(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!confirm(`¿Confirmar que "${lead?.nombre||''}" fue rechazado en la puerta?\nLa pieza regresará a bodega y no se generará venta ni comisión.`)) return;
    const res = await apiPost({ accion: "RECHAZAR_LEAD_ENTREGA", id });
    if (!res.ok) { toast("⚠️ " + (res.error || "No se pudo registrar el rechazo")); return; }
    toast("↩️ Pedido rechazado — pieza devuelta a bodega");
    const codigoVend = lead?.afiliado;
    await cargarDatos();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Recibo de venta para una venta confirmada de afiliado — mismo formato
// térmico (62mm) que el de Venta Directa. El código del afiliado va en una
// línea discreta del footer, en gris chico, para no protagonizar el recibo
// que ve el cliente pero quede trazable de dónde vino la venta.
async function generarReciboLeadPDF(lead, codigoConfirmado){
    if (!window.jspdf?.jsPDF) return;
    const { jsPDF } = window.jspdf;

    // stockData solo se carga al abrir la pestaña Stock — si el admin no la ha
    // abierto en esta sesión, viene vacía y el material/talla no aparecerían.
    if (!stockData || !stockData.length) {
        try { const res = await apiPost({ accion: "GET_STOCK" }); stockData = res.stock || []; } catch(_) {}
    }

    const c = lead.cliente || {};
    const envio = lead.envioInfo || null;
    const total = envio ? parseFloat(envio.total||0) : parseFloat(lead.precio||0);
    const vend  = vendedores.find(v => v.codigo === lead.afiliado);
    const s     = stockData.find(p => p.codigo === codigoConfirmado);

    const W  = 62, mX = 4, cX = W/2, lH = 4.5;

    // Medir el contenido primero para saber el alto real que necesita el papel —
    // el alto fijo anterior cortaba la referencia del afiliado al final.
    const measure = new jsPDF({ unit:'mm', format:[W, 200], orientation:'portrait' });
    const nombreLines = measure.splitTextToSize(lead.nombre || codigoConfirmado || "—", W - mX*2);
    const alturaEstim = 6 + 5.5 + 4 + 4 + 4.5           // header
        + lH*3 + 2                                       // fecha/cliente/tel
        + 3.5 + nombreLines.length*lH + 3.5 + 3.5         // producto + refs
        + (envio ? 8.5 : 0)                               // subtotal/envio
        + 5 + 5                                           // total + forma pago
        + 5 + (vend ? 4.5*2 : 4.5) + 5                     // footer contacto
        + 8 + 8 + 8;                                      // ref afiliado + frase icónica + margen final
    const H = Math.max(78, Math.ceil(alturaEstim));
    const doc = new jsPDF({ unit:'mm', format:[W, H], orientation:'portrait' });
    let y = 6;

    doc.setFont("helvetica","normal"); doc.setFontSize(18); doc.setTextColor(0,0,0);
    doc.text("VEREX", cX, y, { align:"center" }); y += 5.5;
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(80,80,80);
    doc.text("S T O R E", cX, y, { align:"center" }); y += 4;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
    doc.line(mX, y, W-mX, y); y += 4;

    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(0,0,0);
    doc.text("RECIBO DE VENTA", cX, y, { align:"center" }); y += 4.5;

    const fecha = new Date().toLocaleDateString("es-SV", { day:"2-digit", month:"2-digit", year:"numeric" });
    const hora  = new Date().toLocaleTimeString("es-SV", { hour:"2-digit", minute:"2-digit" });
    doc.setFontSize(7); doc.setTextColor(40,40,40);
    [
        ["Fecha:",   fecha + "  " + hora],
        ["Cliente:", c.nombre || "—"],
        ["Tel:",     c.telefono || "—"],
    ].forEach(([label, val]) => {
        doc.setFont("helvetica","normal");   doc.text(label, mX, y);
        doc.setFont("helvetica","normal"); doc.text(String(val), mX+14, y);
        y += lH;
    });
    y += 2;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.3);
    doc.line(mX, y, W-mX, y); y += 3.5;

    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(20,20,20);
    nombreLines.forEach(l => { doc.text(l, mX, y); y += lH; });

    // Referencia (código), talla y material — antes no aparecían en el recibo
    doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(100,100,100);
    doc.text("Ref: " + (codigoConfirmado || "—"), mX, y); y += lH - 1;
    if (s?.talla) { doc.text("Talla: " + s.talla, mX, y); y += lH - 1; }
    if (s?.material) { doc.text(s.material, mX, y); y += lH - 1; }
    doc.setTextColor(20,20,20);
    y += 1;

    doc.setDrawColor(200,200,200); doc.line(mX, y, W-mX, y); y += 3.5;

    if (envio) {
        doc.setFontSize(7);
        doc.text("Subtotal:", mX, y); doc.text("$"+parseFloat(envio.subtotal||0).toFixed(2), W-mX, y, { align:"right" }); y += 4;
        doc.text("Envío:", mX, y); doc.text(envio.envio===0?"GRATIS":"$"+parseFloat(envio.envio).toFixed(2), W-mX, y, { align:"right" }); y += 4.5;
    }
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(0,0,0);
    doc.text("TOTAL:", mX, y); doc.text("$"+total.toFixed(2), W-mX, y, { align:"right" }); y += 5;
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(80,80,80);
    doc.text("Contra entrega, en efectivo", cX, y, { align:"center" }); y += 5;

    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5);
    doc.line(mX, y, W-mX, y); y += 5;

    // Contacto: el WhatsApp del AFILIADO, no el de VEREX — es su venta
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(40,40,40);
    if (vend?.telefono) { doc.text("WhatsApp: " + vend.telefono, cX, y, { align:"center" }); y += 4.5; }
    if (vend?.nombre)   { doc.text("Atendido por: " + vend.nombre, cX, y, { align:"center" }); y += 4.5; }
    doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text("Gracias por su preferencia  VEREX", cX, y, { align:"center" }); y += 5;

    // Código del afiliado — discreto, chico y gris, no protagoniza el recibo
    doc.setFont("helvetica","normal"); doc.setFontSize(5.5); doc.setTextColor(160,160,160);
    doc.text("Ref. afiliado: " + (lead.afiliado || "—"), cX, y, { align:"center" }); y += 5;

    doc.setFont("helvetica","italic"); doc.setFontSize(6.5); doc.setTextColor(160,110,30);
    doc.text("El mundo es mas maravilloso", cX, y, { align:"center" }); y += 4;
    doc.text("cuando brillas TU", cX, y, { align:"center" });

    doc.save("Recibo_" + (c.nombre||"cliente").replace(/ /g,"_") + ".pdf");
}

async function cancelarLeadUI(id) {
    if (!confirm("¿Cancelar este Lead? No se registrará como venta.")) return;
    const res = await apiPost({ accion: "CANCELAR_LEAD", id });
    if (!res.ok) { toast("⚠️ No se pudo cancelar"); return; }
    toast("❌ Lead cancelado");
    const lead = leadsData.find(l => l.id === id);
    const codigoVend = lead?.afiliado;
    await cargarLeads();
    renderVendedores();
    if (codigoVend) renderLeadsModal(codigoVend);
}

// Leads del catálogo público de clientes (sin afiliado) no tienen un pipeline
// de entrega — la venta ya se cierra aparte por "Registrar Venta Directa"
// cuando el cliente confirma por WhatsApp. Este botón solo quita la alerta
// una vez que ya la atendiste (se cerró la venta o el cliente ya no siguió).
// Salta directo a Venta Directa con el producto del Lead ya agregado al
// carrito — evita tener que buscarlo de nuevo a mano. El Lead se marca
// resuelto de una vez (el admin ya está en proceso de cerrar la venta).
let _vdLeadOrigenId = null;   // pedido de catálogo del que salió la venta directa en curso
async function registrarVentaDesdeLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;
    // 1) Primero se libera la pieza apartada por este pedido (si no, el stock aparece en 0 y la venta no se puede armar).
    //    El pedido queda marcado "pasado a venta directa": si la venta no se guarda, se puede restaurar desde PEDIDOS.
    _vdLeadOrigenId = id;
    const resLib = await apiPost({ accion: "CANCELAR_LEAD", id, motivo: "Pasado a venta directa", pendienteVD: true });
    if (!resLib || resLib.ok === false) {
        _vdLeadOrigenId = null;
        toast("⚠️ No se pudo liberar la pieza del pedido — no se abrió la venta", "#c0392b");
        return;
    }
    // 2) Stock fresco del servidor, ya con la pieza liberada.
    try {
        const resSt = await apiPost({ accion: "GET_STOCK" });
        if (resSt && Array.isArray(resSt.stock)) stockData = resSt.stock;
    } catch (_) {}
    await cargarLeads();
    renderAlertasAfiliadosHub();
    cambiarTab('ventadirecta');
    await iniciarVentaDirecta();
    const prod = stockData.find(s => s.codigo === lead.codigo);
    if (prod && parseInt(prod.stock_bodega||0) > 0) {
        agregarAlVD(prod.codigo);
        // Si el catálogo tenía descuento, el lead guarda el precio ya rebajado.
        // Pre-llenar el campo de descuento para que la venta refleje el mismo
        // precio que el cliente vio en el catálogo.
        const precioStock = parseFloat(prod.precio || 0);
        const precioLead  = parseFloat(lead.precio  || 0);
        const diffDesc    = precioStock - precioLead;
        if (diffDesc > 0.005) {
            setModoDescuento('monto');
            const inputDesc = document.getElementById("vd-descuento-val");
            if (inputDesc) {
                inputDesc.value = diffDesc.toFixed(2);
                renderCarritoVD();
            }
        }
        toast(`🛍️ "${prod.nombre}" agregado — revisa los datos del cliente`);
    } else {
        toast(`⚠️ "${lead.nombre||lead.codigo}" ya no está disponible en bodega — agrégalo manualmente si aplica`, "#f97316");
    }

    // Precargar nombre/teléfono/dirección que el cliente ya dejó en el
    // catálogo ANTES de abrir WhatsApp — así VEREX no tiene que volver a
    // preguntarle ni transcribirlos a mano.
    const inpNombre = document.getElementById("vd-cliente-nombre");
    const inpTel    = document.getElementById("vd-cliente-tel");
    const inpDir    = document.getElementById("vd-cliente-direccion");
    const wrapDir   = document.getElementById("vd-cliente-direccion-wrap");
    const selDepto  = document.getElementById("vd-cliente-departamento");
    if (inpNombre && lead.nombreCliente) inpNombre.value = lead.nombreCliente;
    if (inpTel && lead.telefonoCliente)  inpTel.value = lead.telefonoCliente;
    if (lead.direccionCliente) {
        if (wrapDir) wrapDir.style.display = "block";
        if (inpDir) inpDir.value = lead.direccionCliente;
        // Intento best-effort: si el nombre de algún departamento aparece
        // dentro del texto libre de dirección, lo preselecciona — el cliente
        // no llena un select, escribe todo junto en un solo campo.
        if (selDepto) {
            const dirNorm = lead.direccionCliente.toLowerCase();
            const match = [...selDepto.options].find(o => o.value && dirNorm.includes(o.value.toLowerCase()));
            if (match) selDepto.value = match.value;
        }
    }

}

async function resolverLeadClienteDirecto(id) {
    if (!confirm("¿Ya atendiste este interés (se cerró la venta por WhatsApp o el cliente ya no siguió)?\nSe quitará de la alerta.")) return;
    const res = await apiPost({ accion: "CANCELAR_LEAD", id });
    if (!res.ok) { toast("⚠️ No se pudo actualizar"); return; }
    toast("✅ Quitado de la alerta");
    await cargarLeads();
    renderAlertasAfiliadosHub();
}

let _tipoVendedorSel = "consignacion";
