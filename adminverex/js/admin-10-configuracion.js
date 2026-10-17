// Admin VEREX — Configuración (banner, guía C807, carrusel) y cambiar contraseña
// Movido tal cual desde index.html. Se carga con <script> normal (funciones globales: los
// onclick del HTML las llaman por nombre); el orden de carga está en index.html.
// ═════════════════════════════════════════════
//  CONFIG
// ═════════════════════════════════════════════
function guardarConfig() {
    cfg.tiendaActiva=document.getElementById("tog-tienda").checked;
    saveConfig(); renderEstado();
    toast(cfg.tiendaActiva?"✅ Tienda activada":"🔴 Tienda desactivada", cfg.tiendaActiva?"#22c55e":"#ef4444");
}

function guardarToggleVarios() {
    cfg.mostrarVarios = document.getElementById("tog-varios").checked;
    saveConfig();
    toast(cfg.mostrarVarios ? "✅ Categoría Varios activada" : "🔴 Categoría Varios desactivada", cfg.mostrarVarios ? "#22c55e" : "#ef4444");
}

function guardarLimiteCatalogo() {
    const val = parseInt(document.getElementById("inp-limite-catalogo").value) || 0;
    cfg.limiteCatalogo = val;
    saveConfig();
    toast(val > 0 ? `✅ Catálogo limitado a ${val} productos` : "✅ Catálogo sin límite (todos los productos)", "#22c55e");
}

function guardarFraseConfianza() {
    const val = document.getElementById("inp-frase-confianza").value.trim();
    cfg.fraseConfianza = val || FRASE_CONFIANZA_DEFAULT;
    saveConfig();
    toast("✅ Franja de confianza actualizada", "#22c55e");
}

// La apariencia de us.verexstore.com (fotos, textos, secciones…) se edita en ✏️ Editar página USA (editor-us.js).
// Reporte de demanda de VEREX AI (asistente de us.verexstore.com): lo más buscado sin resultado,
// lo que los clientes pidieron conseguir y las preguntas que no tenían respuesta publicada.
// Sirve para decidir qué publicar / traer y qué preguntas frecuentes agregar en ✏️ Editar página USA.
async function cargarDemandaIA() {
    const box = document.getElementById("demanda-ia");
    const meses = document.getElementById("sel-demanda-ia-meses").value;
    box.innerHTML = '<div style="color:#888;">Cargando…</div>';
    let r;
    try {
        r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ accion: "IA_DEMANDA_LISTAR", _pass: ADMIN_PASS, meses }) }).then(x => x.json());
    } catch (e) { r = { ok: false }; }
    if (!r || !r.ok) { box.innerHTML = '<div style="color:#f87171;">No se pudo cargar el reporte. Revisa que el Worker esté actualizado.</div>'; return; }
    const fecha = iso => iso ? new Date(iso).toLocaleDateString("es-SV", { day: "2-digit", month: "short" }) : "";
    const fila = (x, conPedidos) => `
        <div style="padding:8px 10px;border:1px solid #333;border-radius:8px;margin-bottom:6px;background:#161616;">
            <div style="display:flex;justify-content:space-between;gap:8px;">
                <b style="color:#fff;">${esc(x.descripcion)}</b>
                <span style="white-space:nowrap;color:#C9A84C;font-weight:700;">${x.veces} ${x.veces === 1 ? "vez" : "veces"}${conPedidos && x.pedidos ? ` · <span style="color:#22c55e;">${x.pedidos} ${x.pedidos === 1 ? "pidió" : "pidieron"} conseguirlo</span>` : ""}</span>
            </div>
            ${(x.ejemplos || []).length ? `<div style="color:#999;margin-top:4px;">${x.ejemplos.map(e => "“" + esc(e) + "”").join(" · ")}</div>` : ""}
            <div style="color:#666;margin-top:3px;font-size:11px;">Última: ${fecha(x.ultima)}${x.idiomas ? " · " + Object.entries(x.idiomas).map(([l, n]) => `${l.toUpperCase()} ${n}`).join(" / ") : ""}</div>
        </div>`;
    const prods = r.productos || [], preg = r.preguntas || [];
    box.innerHTML = `
        <div style="font-weight:700;margin:6px 0;">🛍️ Productos buscados sin resultado (${prods.length})</div>
        ${prods.length ? prods.map(x => fila(x, true)).join("") : '<div style="color:#888;">Nada todavía.</div>'}
        <div style="font-weight:700;margin:12px 0 6px;">❓ Preguntas sin respuesta (${preg.length})</div>
        <div style="color:#888;font-size:11px;margin-bottom:6px;">Agrégalas en ✏️ Editar página USA → Preguntas y el asistente las responderá.</div>
        ${preg.length ? preg.map(x => fila(x, false)).join("") : '<div style="color:#888;">Nada todavía.</div>'}`;
}

function exportarExcel() {
    const busq    = document.getElementById("bus-ped").value.toLowerCase();
    const fil     = document.getElementById("fil-estado").value;
    let list = pedidos.filter(p =>
        (!busq || (p.cliente||"").toLowerCase().includes(busq) ||
                  (p.productos||"").toLowerCase().includes(busq)) &&
        (!fil  || p.estado === fil)
    );
    list = filtrarPorPeriodo(list);

    if (!list.length) return toast("⚠️ No hay pedidos para exportar","#f97316");

    // Construir datos para Excel
    const rows = list.map(p => ({
        "N° Pedido":   p.numeroPedido || "—",
        "Fecha":       p.fecha ? new Date(p.fecha).toLocaleDateString("es-SV") : "—",
        "Cliente":     p.cliente    || "—",
        "Teléfono":    p.telefono   || "—",
        "Municipio":   p.municipio  || "—",
        "Dirección":   p.direccion  || "—",
        "Productos":   p.productos  || "—",
        "Total":       p.total      || "—",
        "Método Pago": p.metodoPago || "—",
        "Estado":      p.estado     || "—",
    }));

    // Fila de total al final
    const ingresos = list.reduce((s,p) =>
        s + (parseFloat(String(p.total).replace(/[^0-9.]/g,""))||0), 0);
    rows.push({
        "N° Pedido": "", "Fecha": "", "Cliente": "", "Teléfono": "",
        "Municipio": "", "Dirección": "", "Productos": "",
        "Total": `TOTAL: $${ingresos.toFixed(2)}`,
        "Método Pago": "", "Estado": `${list.length} pedidos`,
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Ancho de columnas
    ws["!cols"] = [
        {wch:16},{wch:12},{wch:20},{wch:14},{wch:18},
        {wch:24},{wch:40},{wch:10},{wch:22},{wch:12}
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

    // Nombre del archivo con período
    const periodo = document.getElementById("fil-periodo").value;
    const hoy = new Date();
    const nombrePeriodo = {
        "hoy":    `${hoy.getDate()}-${hoy.getMonth()+1}-${hoy.getFullYear()}`,
        "semana": `Semana_${hoy.getDate()}-${hoy.getMonth()+1}`,
        "mes":    `${hoy.toLocaleString("es",{month:"long"})}_${hoy.getFullYear()}`,
        "custom": "Rango_personalizado",
        "todo":   "Todos_los_pedidos",
    }[periodo] || "Pedidos";

    XLSX.writeFile(wb, `Verex_Ventas_${nombrePeriodo}.xlsx`);
    toast(`✅ Excel exportado: ${list.length} pedidos`, "#22c55e");
}

// ── BANNER ──────────────────────────────────────────────────────────
let bannerColor = "#111111";

function elegirColor(color, el) {
    bannerColor = color;
    document.querySelectorAll(".color-opt").forEach(e => e.style.border = "3px solid transparent");
    el.style.border = "3px solid var(--azul)";
    previewBanner();
}

function previewBanner() {
    const texto = document.getElementById("banner-texto").value.trim();
    const prev  = document.getElementById("banner-preview");
    if (texto) {
        prev.textContent    = texto;
        prev.style.background = bannerColor;
        prev.style.display  = "block";
    } else {
        prev.style.display = "none";
    }
}

function guardarBanner() {
    const activo = document.getElementById("tog-banner").checked;
    const texto  = document.getElementById("banner-texto").value.trim();
    cfg.banner = { activo, texto, color: bannerColor };
    saveConfig();
    toast("✅ Banner guardado", "#22c55e");
}

function renderBannerAdmin() {
    if (!cfg.banner) return;
    document.getElementById("tog-banner").checked  = cfg.banner.activo || false;
    document.getElementById("banner-texto").value  = cfg.banner.texto  || "";
    if (cfg.banner.color) {
        bannerColor = cfg.banner.color;
        document.querySelectorAll(".color-opt").forEach(el => {
            el.style.border = el.dataset.color === bannerColor
                ? "3px solid var(--azul)" : "3px solid transparent";
        });
    }
    previewBanner();
}

// ── GUÍA C807 ────────────────────────────────────────────────────────
let _c807Texto = "";

function mostrarGuiaC807(numeroPedido) {
    const p = pedidos.find(x => x.numeroPedido === numeroPedido);
    if (!p) { toast("⚠️ Pedido no encontrado", "#ef4444"); return; }

    const tel = p.telLlamada || p.telefono || "—";

    const campos = [
        { label: "Número de orden",     valor: String(p.numeroPedido    || "—") },
        { label: "Código de cliente",   valor: String(p.codigoCliente   || "—") },
        { label: "Nombre",              valor: String(p.cliente         || "—") },
        { label: "Teléfono",            valor: String(tel) },
        { label: "Correo",              valor: String(p.correo          || "—") },
        { label: "Departamento",        valor: String(p.departamento || "—") },
        { label: "Municipio/Distrito",  valor: String(p.municipio    || "—") },
        { label: "Dirección",           valor: String(p.direccion    || "—") },
        { label: "Contenido",           valor: String(p.productos    || "—") },
    ];

    _c807Texto = campos.map(c => `${c.label}: ${c.valor}`).join("\n");

    window._c807Campos = campos;   // el botón copia por índice: el valor (datos del cliente) nunca va dentro del onclick
    document.getElementById("c807-contenido").innerHTML = campos.map((c, i) => `
        <div style="margin-bottom:10px;">
            <div style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">${c.label}</div>
            <div style="display:flex;align-items:center;gap:8px;background:#f5f5f5;border-radius:6px;padding:8px 10px;margin-top:3px;">
                <span style="flex:1;font-size:14px;font-weight:500;">${esc(c.valor)}</span>
                <button onclick="navigator.clipboard.writeText(window._c807Campos[${i}].valor);this.textContent='✅';setTimeout(()=>this.textContent='📋',1500)"
                    style="background:none;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">📋</button>
            </div>
        </div>`).join('');

    const modal = document.getElementById("modal-c807");
    modal.style.display = "flex";
    // Abrir C807 automáticamente
    window.open('https://app.c807.com/xpress/#/tra/crear_guia', '_blank');
}

function copiarTodoC807() {
    navigator.clipboard.writeText(_c807Texto);
    toast("✅ Datos copiados al portapapeles", "#00875A");
}

// ── CARRUSEL ─────────────────────────────────────────────────────────
function renderCarruselAdmin() {
    if (!cfg.carrusel) cfg.carrusel = { activo: false, slides: [] };
    document.getElementById("tog-carrusel").checked = cfg.carrusel.activo || false;
    const lista = document.getElementById("lista-carrusel");
    if (!cfg.carrusel.slides.length) {
        lista.innerHTML = '<p style="font-size:13px;color:#aaa;margin-bottom:10px;">No hay imágenes agregadas.</p>';
        return;
    }
    lista.innerHTML = cfg.carrusel.slides.map((s, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--borde);border-radius:8px;margin-bottom:8px;">
            <img src="${s.url}" style="width:60px;height:50px;object-fit:cover;border-radius:6px;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2250%22><rect width=%2260%22 height=%2250%22 fill=%22%23eee%22/><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2210%22>?</text></svg>'">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.titulo || "Sin título"}</div>
                <div style="font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.subtitulo || ""}</div>
            </div>
            <button class="btn br" style="padding:5px 10px;font-size:12px;flex-shrink:0;" onclick="eliminarSlide(${i})">🗑️</button>
        </div>`).join('');
}

function agregarSlide() {
    const url      = document.getElementById("car-url").value.trim();
    const titulo   = document.getElementById("car-titulo").value.trim();
    const subtitulo = document.getElementById("car-subtitulo").value.trim();
    if (!url) return toast("⚠️ Ingresa una URL de imagen", "#ef4444");
    if (!cfg.carrusel) cfg.carrusel = { activo: false, slides: [] };
    if (cfg.carrusel.slides.length >= 4) return toast("⚠️ Máximo 4 imágenes", "#ef4444");
    cfg.carrusel.slides.push({ url, titulo, subtitulo });
    document.getElementById("car-url").value = "";
    document.getElementById("car-titulo").value = "";
    document.getElementById("car-subtitulo").value = "";
    renderCarruselAdmin();
    toast("✅ Imagen agregada", "#22c55e");
}

function eliminarSlide(i) {
    cfg.carrusel.slides.splice(i, 1);
    renderCarruselAdmin();
}

function guardarCarrusel() {
    if (!cfg.carrusel) cfg.carrusel = { activo: false, slides: [] };
    cfg.carrusel.activo = document.getElementById("tog-carrusel").checked;
    saveConfig();
    toast("✅ Carrusel guardado", "#22c55e");
}

function saveConfig() {
    localStorage.setItem("vx_cfg",JSON.stringify(cfg));
    fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:"ACTUALIZAR_CONFIG",_pass:ADMIN_PASS,config:cfg})});
}

// ═════════════════════════════════════════════
//  CAMBIAR CONTRASEÑA
// ═════════════════════════════════════════════
function abrirCambiarClave() {
    document.getElementById("pass-actual").value = "";
    document.getElementById("pass-nueva").value = "";
    document.getElementById("pass-confirmar").value = "";
    document.getElementById("pass-error").style.display = "none";
    document.getElementById("modal-pass").style.display = "flex";
}

async function hashStr(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function guardarNuevaClave() {
    const actual    = document.getElementById("pass-actual").value;
    const nueva     = document.getElementById("pass-nueva").value;
    const confirmar = document.getElementById("pass-confirmar").value;
    const errEl     = document.getElementById("pass-error");
    errEl.style.display = "none";

    if (!actual || !nueva || !confirmar) { errEl.textContent = "⚠️ Completa todos los campos"; errEl.style.display = "block"; return; }
    if (nueva.length < 6) { errEl.textContent = "⚠️ Mínimo 6 caracteres"; errEl.style.display = "block"; return; }
    if (nueva !== confirmar) { errEl.textContent = "⚠️ Las contraseñas no coinciden"; errEl.style.display = "block"; return; }
    const btn = document.querySelector("#modal-pass button:last-child");
    btn.textContent = "⏳ Guardando..."; btn.disabled = true;
    try {
        // La contraseña actual se comprueba con el servidor (antes se comparaba contra
        // ADMIN_PASS, que es el pase de sesión — nunca coincidía).
        const chk = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"VERIFICAR_PASS", _pass: await hashStr(actual) }) }).then(r => r.json()).catch(() => ({ ok:false }));
        if (!chk.ok) {
            errEl.textContent = "⚠️ Contraseña actual incorrecta"; errEl.style.display = "block";
            btn.textContent = "💾 Guardar Nueva Contraseña"; btn.disabled = false;
            return;
        }
        const nuevoHash = await hashStr(nueva);
        const r = await fetch(API_URL, { method:'POST', body: JSON.stringify({ accion:"ACTUALIZAR_PASS_HASH", _pass: ADMIN_PASS, nuevoHash }) }).then(x => x.json());
        if (!r.ok) throw new Error(r.error || "sin permiso");
        document.getElementById("modal-pass").style.display = "none";
        // Cambiar la contraseña cierra todas las sesiones (también esta).
        alert("✅ Contraseña actualizada. Se cerraron todas las sesiones: vuelve a entrar con la contraseña nueva.");
        logout();
        return;
    } catch(e) {
        errEl.textContent = "⚠️ Error al guardar"; errEl.style.display = "block";
    }
    btn.textContent = "💾 Guardar Nueva Contraseña"; btn.disabled = false;
}
