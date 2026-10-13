// ═══════════════════════════════════════════════════════════════════
//  🤖 Lyra WhatsApp — panel del Admin
//  - Encendido y modo de atención (pruebas / anuncios / todos)
//  - «Promo de Lyra»: la ÚNICA promo que Lyra pone en los catálogos que arma, solo entre sus fechas
//  - Anuncio → piezas: cuando un cliente llega desde ese anuncio de Meta, Lyra le muestra esas piezas
//  Se guarda en el Worker (config/lyra) con LYRA_CONFIG_SET; no sale en la tienda pública.
//  Lyra lo toma en ~1 minuto (caché del catálogo). Usa globales del Admin: API_URL, ADMIN_PASS, cfg, toast().
// ═══════════════════════════════════════════════════════════════════
const ly = { cfg: null, vistos: [], sucio: false };
const lyEl = id => document.getElementById(id);
const lyEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lyApi = (accion, extra) => fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, _pass: ADMIN_PASS, ...extra }) }).then(r => r.json());
const lyHoySV = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);

function lyMontar() {
    if (lyEl("lyra-wa")) return;
    const st = document.createElement("style");
    st.textContent = `
#lyra-wa{position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.7);display:none;align-items:flex-start;justify-content:center;padding:24px 12px}
#lyra-wa.abierto{display:flex}
#lyra-wa *{box-sizing:border-box}
.ly-box{background:#111;color:#eee;border:1px solid #2a2a2a;border-radius:14px;width:100%;max-width:760px;font-family:inherit;max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden}
#ly-cuerpo{overflow-y:auto;flex:1}
#lyra-wa label{text-transform:none;letter-spacing:normal}
.ly-top{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #2a2a2a;background:#111;flex-shrink:0}
.ly-top h2{margin:0 auto 0 0;font-size:16px;color:#C9A84C}
.ly-sec{padding:16px;border-bottom:1px solid #222}
.ly-sec h3{margin:0 0 4px;font-size:14px;color:#fff}
.ly-nota{font-size:11px;color:#888;margin:0 0 10px;line-height:1.5}
.ly-b{padding:7px 12px;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#ddd;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.ly-b:hover{border-color:#C9A84C;color:#C9A84C}
.ly-b.oro{background:#C9A84C;border-color:#C9A84C;color:#111}
.ly-b.rojo{color:#f87171;border-color:#7f1d1d}
.ly-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.ly-f label{display:block;font-size:11px;color:#aaa;margin-bottom:4px;text-transform:none;letter-spacing:normal}
.ly-f input,.ly-f select,.ly-f textarea{width:100%;padding:8px 10px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#eee;font-size:13px;font-family:inherit}
.ly-f textarea{resize:vertical;min-height:54px}
.ly-sw{display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;margin-bottom:10px}
.ly-sw input{width:18px;height:18px;accent-color:#C9A84C}
.ly-chip{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:3px 9px}
.ly-ad{border:1px solid #2a2a2a;border-radius:10px;padding:10px;margin-bottom:10px;background:#151515}
.ly-vis{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #1f1f1f;font-size:12px}
.ly-wa{background:#0b141a;border-radius:10px;padding:10px 12px;font-size:12px;color:#e9edef;white-space:pre-wrap;line-height:1.5;margin-top:10px}
`;
    document.head.appendChild(st);
    const d = document.createElement("div");
    d.id = "lyra-wa";
    d.innerHTML = `<div class="ly-box">
      <div class="ly-top"><h2>🤖 Lyra en WhatsApp</h2>
        <button class="ly-b oro" onclick="lyGuardar()">💾 Guardar</button>
        <button class="ly-b" onclick="cerrarLyraWA()">✕</button></div>
      <div id="ly-cuerpo"><div class="ly-sec">Cargando…</div></div>
    </div>`;
    d.addEventListener("click", e => { if (e.target === d) cerrarLyraWA(); });
    d.addEventListener("input", () => { ly.sucio = true; lyPintarEstadoPromo(); });
    d.addEventListener("change", () => { ly.sucio = true; lyPintarEstadoPromo(); });
    document.body.appendChild(d);
}

async function abrirLyraWA() {
    lyMontar();
    lyEl("lyra-wa").classList.add("abierto");
    lyEl("ly-cuerpo").innerHTML = `<div class="ly-sec">Cargando…</div>`;
    try {
        const r = await lyApi("LYRA_CONFIG_GET");
        if (!r.ok) throw new Error(r.error || "sin permiso");
        ly.cfg = r.lyra || {}; ly.vistos = r.anunciosVistos || []; ly.sucio = false;
        lyPintar();
    } catch (e) {
        lyEl("ly-cuerpo").innerHTML = `<div class="ly-sec" style="color:#f87171">⚠️ No se pudo cargar: ${lyEsc(e.message)}</div>`;
    }
}
function cerrarLyraWA() {
    if (ly.sucio && !confirm("Tienes cambios sin guardar en Lyra. ¿Cerrar sin guardar?")) return;
    lyEl("lyra-wa").classList.remove("abierto");
}

function lyPintar() {
    const c = ly.cfg || {}, p = c.promo || {}, pc = p.promoCarrito || {};
    const opt = (v, t, sel) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`;
    lyEl("ly-cuerpo").innerHTML = `
    <div class="ly-sec">
      <h3>Encendido y a quién atiende</h3>
      <p class="ly-nota">Lyra solo contesta, nunca escribe primero. Cuando alguien del equipo escribe en un chat desde la app, Lyra se calla en ese chat. Los cambios se aplican en 1 minuto aprox.</p>
      <label class="ly-sw"><input type="checkbox" id="ly-activa" ${c.activa !== false ? "checked" : ""}> <b>Lyra contesta en WhatsApp</b></label>
      <div class="ly-f" style="max-width:520px"><label>Modo de atención</label>
        <select id="ly-modo">
          ${opt("", "Lo que diga Cloudflare (WA_LYRA_MODE, por defecto «pruebas»)", c.modo || "")}
          ${opt("pruebas", "🧪 Pruebas — solo los números de prueba", c.modo)}
          ${opt("anuncios", "📣 Anuncios — clientes que llegan de un anuncio de Meta (los demás los atiende el equipo)", c.modo)}
          ${opt("todos", "💬 Todos los que escriban", c.modo)}
        </select></div>
      <p class="ly-nota" style="margin-top:8px">El interruptor de emergencia de Cloudflare (WA_LYRA_ENABLED=false) siempre manda sobre esto.</p>
    </div>

    <div class="ly-sec">
      <h3>🎁 Promo de Lyra</h3>
      <p class="ly-nota">La única promo que Lyra pone en los catálogos que arma por WhatsApp, y solo entre las fechas (días de El Salvador). Sin fecha de fin no se ofrece. Lyra nunca inventa descuentos. Descuento máximo 50%.</p>
      <label class="ly-sw"><input type="checkbox" id="ly-p-activa" ${p.activa ? "checked" : ""}> <b>Promo encendida</b> <span id="ly-p-estado"></span></label>
      <div class="ly-g ly-f">
        <div><label>Nombre (solo para ti)</label><input id="ly-p-nombre" value="${lyEsc(p.nombre)}" placeholder="Promo octubre"></div>
        <div><label>Desde</label><input type="date" id="ly-p-desde" value="${lyEsc(p.desde)}"></div>
        <div><label>Hasta (inclusive)</label><input type="date" id="ly-p-hasta" value="${lyEsc(p.hasta)}"></div>
      </div>
      <div class="ly-g ly-f" style="margin-top:10px">
        <div><label>Texto del banner</label><input id="ly-p-btxt" maxlength="80" value="${lyEsc(p.banner?.txt)}" placeholder="10% en tu primera compra"></div>
        <div><label>Subtexto</label><input id="ly-p-bsub" maxlength="120" value="${lyEsc(p.banner?.sub)}" placeholder="Solo por WhatsApp"></div>
        <div><label>% de descuento (necesita banner)</label><input type="number" min="0" max="50" id="ly-p-pct" value="${p.descPct || ""}"></div>
      </div>
      <div class="ly-g ly-f" style="margin-top:10px">
        <div><label>Promo de carrito</label><select id="ly-p-tipo">
          ${opt("", "Ninguna", pc.tipo || "")}${opt("2x50", "2do producto al 50%", pc.tipo)}${opt("3x2", "3x2 (la más barata gratis)", pc.tipo)}${opt("montoFijo", "$ de descuento", pc.tipo)}
          ${pc.tipo === "escalonado" ? opt("escalonado", "Escalonado (como estaba)", pc.tipo) : ""}</select></div>
        <div><label>$ de descuento</label><input type="number" min="0" step="0.5" id="ly-p-monto" value="${pc.montoFijo || ""}"></div>
        <div><label>…por cada $ de compra (opcional)</label><input type="number" min="0" id="ly-p-min" value="${pc.minimoCompra || ""}"></div>
      </div>
      <div class="ly-g ly-f" style="margin-top:10px">
        <div><label>Envío gratis desde $</label><input type="number" min="0" id="ly-p-envio" value="${p.envioGratisDesde || ""}"></div>
        <div><label>Regalo sorpresa desde $</label><input type="number" min="0" id="ly-p-rmonto" value="${p.regaloSorpresa?.monto || ""}"></div>
        <div><label>Regalo (texto)</label><input id="ly-p-rtxt" maxlength="80" value="${lyEsc(p.regaloSorpresa?.texto)}" placeholder="Pulsera sorpresa"></div>
      </div>
      <div style="margin-top:10px"><button class="ly-b" onclick="lyCopiarPromoGeneral()">📋 Copiar la promo general de los catálogos</button></div>
      <div class="ly-wa" id="ly-p-vista"></div>
    </div>

    <div class="ly-sec">
      <h3>📣 Anuncios → piezas</h3>
      <p class="ly-nota">Cuando un cliente llega a WhatsApp desde este anuncio de Meta, Lyra lo saluda y le muestra estas piezas (con foto, precio y tallas), y le ofrece el catálogo con ellas. Usa el código base (ANP240) o uno con talla (ANP240T7). Máximo 12 piezas por anuncio.</p>
      <div id="ly-ads"></div>
      <button class="ly-b" onclick="lyAgregarAnuncio()">➕ Agregar anuncio</button>
      <div style="margin-top:16px">
        <div style="font-size:12px;font-weight:700;color:#ccc">Anuncios de los que llegaron clientes</div>
        <p class="ly-nota" style="margin:2px 0 4px">Lyra los anota sola (aunque esté en modo pruebas). Toca «Asignar piezas» para agregarlo arriba.</p>
        <div id="ly-vistos"></div>
      </div>
    </div>`;
    ly.ads = (c.anuncios || []).map(a => ({ ...a, codigos: (a.codigos || []).join(", ") }));
    lyPintarAnuncios(); lyPintarVistos(); lyPintarEstadoPromo();
}

function lyLeerPromo() {
    const v = id => (lyEl(id)?.value || "").trim();
    const n = id => parseFloat(v(id)) || 0;
    const tipo = v("ly-p-tipo");
    const previo = ly.cfg?.promo?.promoCarrito;
    let promoCarrito = null;
    if (tipo === "montoFijo") promoCarrito = n("ly-p-monto") > 0 ? { tipo, montoFijo: n("ly-p-monto"), ...(n("ly-p-min") > 0 && { minimoCompra: n("ly-p-min") }) } : null;
    else if (tipo === "escalonado") promoCarrito = previo?.tipo === "escalonado" ? previo : null;
    else if (tipo) promoCarrito = { tipo };
    const btxt = v("ly-p-btxt");
    return {
        activa: !!lyEl("ly-p-activa")?.checked, nombre: v("ly-p-nombre"), desde: v("ly-p-desde"), hasta: v("ly-p-hasta"),
        ...(btxt && { banner: { txt: btxt, sub: v("ly-p-bsub"), color: ly.cfg?.promo?.banner?.color || "#C9A84C" } }),
        ...(btxt && n("ly-p-pct") > 0 && { descPct: Math.min(50, Math.round(n("ly-p-pct"))) }),
        ...(promoCarrito && { promoCarrito }),
        ...(n("ly-p-envio") > 0 && { envioGratisDesde: n("ly-p-envio") }),
        ...(n("ly-p-rmonto") > 0 && v("ly-p-rtxt") && { regaloSorpresa: { monto: n("ly-p-rmonto"), texto: v("ly-p-rtxt") } }),
    };
}

// Mismo criterio que Lyra (functions/_lib/wa/catalogo.js → promoVigente / promoLinea)
function lyPintarEstadoPromo() {
    const el = lyEl("ly-p-estado"); if (!el) return;
    const p = lyLeerPromo(), hoy = lyHoySV();
    let chip;
    if (!p.activa) chip = ["⚪ Apagada", "#9ca3af", "#1f2937"];
    else if (!p.hasta) chip = ["⚠️ Falta la fecha de fin — no se ofrece", "#fbbf24", "#3a2a05"];
    else if (p.desde && hoy < p.desde) chip = [`⏳ Empieza el ${p.desde}`, "#93c5fd", "#0c2440"];
    else if (hoy > p.hasta) chip = ["⚪ Vencida", "#9ca3af", "#1f2937"];
    else chip = [`🟢 Vigente hoy (hasta el ${p.hasta})`, "#4ade80", "#052e16"];
    el.innerHTML = `<span class="ly-chip" style="color:${chip[1]};background:${chip[2]}">${lyEsc(chip[0])}</span>`;
    const partes = [];
    if (p.banner?.txt) partes.push(p.banner.txt);
    else if (p.promoCarrito?.tipo === "2x50") partes.push("2do producto al 50%");
    else if (p.promoCarrito?.tipo === "3x2") partes.push("3x2: la 3ra pieza gratis");
    else if (p.promoCarrito?.tipo === "montoFijo") partes.push(`$${Number(p.promoCarrito.montoFijo).toFixed(2)} de descuento`);
    if (p.envioGratisDesde > 0 && !/env[ií]o/i.test(partes.join(" "))) partes.push(`envío gratis desde $${Number(p.envioGratisDesde).toFixed(2)}`);
    const linea = partes.length ? (/^\p{Extended_Pictographic}/u.test(partes.join(" · ")) ? partes.join(" · ") : "🎁 " + partes.join(" · ")) : "(sin promo)";
    const avisoPct = (parseFloat(lyEl("ly-p-pct")?.value) > 0 && !p.banner) ? "\n⚠️ El % de descuento solo se aplica si escribes el texto del banner." : "";
    lyEl("ly-p-vista").textContent = `Así la anuncia Lyra al mandar un catálogo:\n¡Listo, Ana! ✨ Te armé un catálogo con 6 piezas:\nhttps://admin-tienda.pages.dev/c/abc123\n…\n${linea}${p.descPct && p.banner ? `\n(en el catálogo los precios ya salen con ${p.descPct}% menos)` : ""}${avisoPct}`;
}

function lyCopiarPromoGeneral() {
    const g = (typeof cfg !== "undefined" && cfg.promoGeneral) || null;
    if (!g) return toast("No hay promo general guardada", "#f97316");
    const set = (id, v) => { const el = lyEl(id); if (el) el.value = v ?? ""; };
    set("ly-p-btxt", g.banner?.txt); set("ly-p-bsub", g.banner?.sub);
    set("ly-p-tipo", ["2x50", "3x2", "montoFijo"].includes(g.promoCarrito?.tipo) ? g.promoCarrito.tipo : "");
    set("ly-p-monto", g.promoCarrito?.montoFijo || ""); set("ly-p-min", g.promoCarrito?.minimoCompra || "");
    set("ly-p-envio", g.envioGratisDesde || ""); set("ly-p-rmonto", g.regaloSorpresa?.monto || ""); set("ly-p-rtxt", g.regaloSorpresa?.texto || "");
    ly.sucio = true; lyPintarEstadoPromo();
    toast("📋 Copiada — revisa las fechas y guarda", "#22c55e");
}

function lyLeerAnuncios() {
    document.querySelectorAll("#ly-ads .ly-ad").forEach((el, i) => {
        const a = ly.ads[i]; if (!a) return;
        a.adId = el.querySelector(".ly-a-id").value.trim();
        a.nombre = el.querySelector(".ly-a-nombre").value.trim();
        a.codigos = el.querySelector(".ly-a-cods").value.trim();
        a.mensaje = el.querySelector(".ly-a-msg").value.trim();
    });
}
function lyPintarAnuncios() {
    const box = lyEl("ly-ads"); if (!box) return;
    box.innerHTML = ly.ads.length ? ly.ads.map((a, i) => `
      <div class="ly-ad">
        <div class="ly-g ly-f">
          <div><label>ID del anuncio (Meta)</label><input class="ly-a-id" inputmode="numeric" value="${lyEsc(a.adId)}" placeholder="120251466699280346"></div>
          <div><label>Nombre (solo para ti)</label><input class="ly-a-nombre" value="${lyEsc(a.nombre)}" placeholder="Anillos de plata"></div>
        </div>
        <div class="ly-f" style="margin-top:8px"><label>Códigos de las piezas (separados por coma)</label><input class="ly-a-cods" value="${lyEsc(a.codigos)}" placeholder="ANP240, ANP013, CDP020"></div>
        <div class="ly-f" style="margin-top:8px"><label>Saludo (opcional — si lo dejas vacío Lyra usa el suyo)</label><textarea class="ly-a-msg" maxlength="300" placeholder="¡Hola! 💎 Estos son los anillos del anuncio…">${lyEsc(a.mensaje)}</textarea></div>
        <div style="text-align:right;margin-top:6px"><button class="ly-b rojo" onclick="lyQuitarAnuncio(${i})">🗑️ Quitar</button></div>
      </div>`).join("") : `<p class="ly-nota">Todavía no hay anuncios con piezas asignadas.</p>`;
}
function lyAgregarAnuncio(adId = "", nombre = "") {
    lyLeerAnuncios();
    ly.ads.push({ adId, nombre, codigos: "", mensaje: "" });
    ly.sucio = true; lyPintarAnuncios(); lyPintarVistos();
    const ultimo = [...document.querySelectorAll("#ly-ads .ly-a-cods")].pop(); if (ultimo) ultimo.focus();
}
function lyQuitarAnuncio(i) { lyLeerAnuncios(); ly.ads.splice(i, 1); ly.sucio = true; lyPintarAnuncios(); lyPintarVistos(); }
function lyPintarVistos() {
    const box = lyEl("ly-vistos"); if (!box) return;
    const asignados = new Set(ly.ads.map(a => String(a.adId).replace(/\D/g, "")));
    box.innerHTML = ly.vistos.length ? ly.vistos.map((v, i) => `
      <div class="ly-vis">
        <div style="min-width:0"><div style="color:#eee;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lyEsc(v.titulo || "(sin título)")}</div>
          <div style="color:#777;font-size:11px">ID ${lyEsc(v.adId)} · ${v.n || 0} cliente${v.n === 1 ? "" : "s"} · último: ${v.ultimo ? new Date(v.ultimo).toLocaleString("es-SV", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</div></div>
        ${asignados.has(v.adId) ? `<span class="ly-chip" style="color:#4ade80;background:#052e16">✓ Con piezas</span>` : `<button class="ly-b" onclick="lyAsignarVisto(${i})">➕ Asignar piezas</button>`}
      </div>`).join("") : `<p class="ly-nota">Aún no ha llegado nadie desde un anuncio.</p>`;
}
function lyAsignarVisto(i) { const v = ly.vistos[i]; if (v) lyAgregarAnuncio(v.adId, v.titulo || ""); }

async function lyGuardar() {
    if (!ly.cfg) return;
    lyLeerAnuncios();
    const promo = lyLeerPromo();
    if (promo.activa && !promo.hasta) return toast("⚠️ Pon la fecha de fin de la promo (sin fecha no se ofrece)", "#f97316");
    if (promo.desde && promo.hasta && promo.hasta < promo.desde) return toast("⚠️ La fecha de fin es antes que la de inicio", "#f97316");
    const incompletos = ly.ads.filter(a => (a.adId || a.codigos) && !(String(a.adId).replace(/\D/g, "") && a.codigos));
    if (incompletos.length) return toast("⚠️ Cada anuncio necesita su ID y al menos un código", "#f97316");
    const lyra = {
        activa: !!lyEl("ly-activa").checked, modo: lyEl("ly-modo").value, promo,
        anuncios: ly.ads.filter(a => a.adId && a.codigos).map(a => ({ adId: a.adId, nombre: a.nombre, codigos: a.codigos, mensaje: a.mensaje })),
    };
    try {
        const r = await lyApi("LYRA_CONFIG_SET", { lyra });
        if (!r.ok) throw new Error(r.error || "error");
        ly.cfg = r.lyra; ly.sucio = false;
        lyPintar();
        toast("✅ Lyra actualizada — se aplica en 1 minuto aprox.", "#22c55e");
    } catch (e) {
        toast("❌ No se pudo guardar: " + e.message, "#ef4444");
    }
}
