// ═══════════════════════════════════════════════════════════════════
//  ✏️ Editar página USA — modal del Admin para us.verexstore.com
//  Fotos de la portada (hasta 10) y de las categorías, todos los textos
//  (ES/EN), orden y visibilidad de las secciones, categorías, preguntas
//  frecuentes, políticas y WhatsApp. Vista previa en vivo: la página real
//  cargada con ?vxpreview=1, que pinta el borrador sin guardarlo.
//  Se guarda en config/settings → contenidoUS (+ categorias) con GUARDAR_CONFIG.
//  Usa globales del Admin: API_URL, ADMIN_PASS, cfg, esc(), toast().
// ═══════════════════════════════════════════════════════════════════
const EDUS_DEF = {"faqs": {"es": [{"q": "¿De qué material son las piezas?", "a": "Plata 925, Plata 925 con Oro Laminado o Acero Inoxidable 316L, según la pieza — el material se indica en cada producto del catálogo."}, {"q": "¿Cómo sé cuál es mi talla de anillo?", "a": "Rodea tu dedo con una cinta de papel, marca el punto donde se une, mídela en centímetros y compárala con nuestra guía de tallas (de la 5 a la 14). {guia}"}, {"q": "¿Cuánto tarda en llegar mi pedido?", "a": "Entre 5 y 7 días hábiles por DHL, después de confirmar el pago."}, {"q": "¿Cuánto cuesta el envío?", "a": "Depende del monto de tu compra — mirá la sección de Envíos para ver la tabla completa. Es gratis en compras de $150 o más."}, {"q": "¿Hay un monto mínimo de compra?", "a": "Sí, $50."}, {"q": "¿Mi pedido tendrá cargos de aduana?", "a": "No todos los pedidos generan cargos aduaneros. En caso de que las autoridades de Estados Unidos apliquen impuestos o aranceles de importación, estos deberán ser cubiertos por el cliente y no estarán incluidos en el precio de los productos ni en el costo de envío."}, {"q": "¿Qué métodos de pago aceptan?", "a": "PayPal y tarjeta (Visa/Mastercard)."}, {"q": "¿Es seguro pagar en el sitio?", "a": "Sí — el pago lo procesan PayPal o Wompi directamente. VEREX nunca ve ni guarda el número de tu tarjeta, y nunca compartimos ni vendemos tu información personal."}, {"q": "¿Cómo hago seguimiento de mi pedido?", "a": "Te llega un correo de confirmación apenas confirmás el pedido, y el número de tracking de DHL una vez que se envía."}, {"q": "¿Puedo cambiar o devolver un producto?", "a": "Solo si llega defectuoso, dañado o hubo un error nuestro. Los pedidos internacionales son venta final — mirá la sección de Cambios y devoluciones para el detalle completo."}], "en": [{"q": "What are the pieces made of?", "a": "Sterling Silver, Sterling Silver with Gold Plating, or Stainless Steel, depending on the piece — the material is listed on each product."}, {"q": "How do I know my ring size?", "a": "Wrap a strip of paper around your finger, mark where it meets, measure it in centimeters and compare it with our size guide (sizes 5 to 14). {guia}"}, {"q": "How long does my order take to arrive?", "a": "5–7 business days via DHL, after we confirm your payment."}, {"q": "How much does shipping cost?", "a": "Depends on your purchase amount — see the Shipping section for the full table. It's free on orders of $150 or more."}, {"q": "Is there a minimum order?", "a": "Yes, $50."}, {"q": "Will my order have customs charges?", "a": "Not every order incurs customs charges. If U.S. authorities apply import taxes or duties, they must be paid by the customer and are not included in the product price or the shipping cost."}, {"q": "What payment methods do you accept?", "a": "PayPal and card (Visa/Mastercard)."}, {"q": "Is it safe to pay on the site?", "a": "Yes — payment is processed directly by PayPal or Wompi. VEREX never sees or stores your card number, and we never share or sell your personal information."}, {"q": "How do I track my order?", "a": "You'll get a confirmation email as soon as you place your order, and the DHL tracking number once it ships."}, {"q": "Can I exchange or return a product?", "a": "Only if it arrives defective, damaged, or there was an error on our part. International orders are final sale — see the Returns & exchanges section for full details."}]}, "pol": {"envios": {"es": "Todos los pedidos se envían por DHL, con una entrega estimada de 5 a 7 días hábiles después de confirmar tu pago.", "en": "All orders ship via DHL, with an estimated delivery time of 5–7 business days after we confirm your payment."}, "pago": {"es": "Aceptamos PayPal y pago con tarjeta (Visa/Mastercard). Al confirmar tu pedido, te llevamos directo a la pantalla de pago segura con el monto exacto — no tenés que esperar nada.\nTu pedido se prepara y se envía una vez que confirmamos el pago.\nPayPal\nVisa\nMastercard", "en": "We accept PayPal and card payments (Visa/Mastercard). When you confirm your order, we take you straight to the secure payment page with the exact amount — no need to wait for anything.\nYour order is prepared and shipped once payment is confirmed.\nPayPal\nVisa\nMastercard"}, "despues": {"es": "Te llega un correo de confirmación con el resumen de tu compra. Cuando confirmemos tu pago, preparamos y enviamos tu pedido, y te compartimos el número de tracking de DHL.", "en": "You'll get a confirmation email with your order summary. Once we confirm your payment, we'll prepare and ship your order and share the DHL tracking number with you."}, "aduana": {"es": "Tu pedido se envía desde El Salvador hacia Estados Unidos. Al tratarse de un envío internacional, las autoridades aduaneras de Estados Unidos podrían aplicar impuestos o aranceles de importación al momento de ingresar el paquete al país. Si estos cargos corresponden, deberán ser cubiertos por el cliente, ya que no están incluidos en el precio de los productos ni en el costo de envío pagado a VEREX.", "en": "Your order ships from El Salvador to the United States. Because it is an international shipment, U.S. customs authorities may apply import taxes or duties when the package enters the country. If these charges apply, they must be paid by the customer, as they are not included in the price of the products or in the shipping cost paid to VEREX."}, "cambios": {"es": "Todos los pedidos internacionales son venta final.\nDebido al alto costo de los envíos internacionales, VEREX no acepta cambios ni devoluciones por cambio de opinión, elección incorrecta de talla, preferencia personal u otras razones ajenas a un defecto del producto o a un error de nuestra parte.\nSin embargo, si recibes:\n- Una pieza defectuosa.\n- Una pieza dañada.\n- Un producto diferente al solicitado.\n- Una talla incorrecta enviada por VEREX.\nComunícate con nosotros dentro de las 72 horas posteriores a la entrega, enviando fotografías del producto y del empaque.\nSi confirmamos que el inconveniente es responsabilidad de VEREX, te ofreceremos una solución que puede incluir reemplazo, cambio o reembolso.\nLos impuestos, aranceles y cargos aduaneros aplicables en Estados Unidos son responsabilidad del comprador y no son reembolsables por VEREX.\nNo envíes ningún producto de regreso sin autorización previa de VEREX.", "en": "International orders are final sale.\nDue to the high cost of international shipping, VEREX does not accept exchanges or returns for change of mind, incorrect size selection, personal preference, or other reasons unrelated to a product defect or an error on our part.\nHowever, if you receive:\n- A defective piece.\n- A damaged piece.\n- A different product than what you ordered.\n- An incorrect size sent by VEREX.\nContact us within 72 hours of delivery, sending photos of the product and the packaging.\nIf we confirm the issue is VEREX's responsibility, we'll offer a solution that may include a replacement, exchange, or refund.\nTaxes, duties, and customs charges applicable in the United States are the buyer's responsibility and are not refundable by VEREX.\nDo not send any product back without prior authorization from VEREX."}}};
const EDUS_PREVIEW_URL = "https://us.verexstore.com/?vxpreview=1";
const EDUS_PREVIEW_ORIGEN = new URL(EDUS_PREVIEW_URL).origin;
const EDUS_MAX_FOTOS = 10;
const EDUS_POLS = [
    { k: "envios",  t: "🚚 Envíos", nota: "Solo la primera frase. La tabla de tarifas y el pedido mínimo siguen siendo automáticos." },
    { k: "pago",    t: "💳 Formas de pago" },
    { k: "despues", t: "📦 Después de tu pedido" },
    { k: "aduana",  t: "🛃 Aduana y aranceles" },
    { k: "cambios", t: "🔄 Cambios y devoluciones" },
];
const EDUS_SECCIONES = {
    hero:       { t: "🖼️ Portada (fotos, título y botones)" },
    franja:     { t: "🚚 Franja de confianza" },
    nuevos:     { t: "✨ Novedades", nota: "Solo aparece si hay productos de los últimos 15 días." },
    categorias: { t: "🗂️ Comprar por categoría" },
    destacados: { t: "⭐ Más vendidos", nota: "Solo aparece si hay productos marcados como destacados." },
};
// Estos textos se guardan en sus campos de siempre (los lee también el asistente Lyra y el editor del Hub)
const EDUS_LEGADO = { heroTitle: "heroTitulo", heroSubtitle: "heroSubtitulo", footerTag: "footerTagline", heroCta: "heroCta", heroTrust: "heroTrust", trustBar: "franja" };
const EDUS_DEF_CATS = [{ codigo: "AN", es: "Anillos", en: "Rings" }, { codigo: "CO", es: "Collares", en: "Necklaces" }, { codigo: "CD", es: "Cadenas", en: "Chains" }, { codigo: "AR", es: "Aretes", en: "Earrings" }, { codigo: "PU", es: "Pulseras", en: "Bracelets" }, { codigo: "CJ", es: "Conjuntos", en: "Sets" }];

const edus = {
    abierto: false, sucio: false, tab: "publicados", lang: "es",
    base: {}, catsGuardadas: [], catsTocadas: false,
    fotos: [], fotosCat: {}, textos: {}, secciones: [], cats: [], faqs: [], pols: {}, wa: "",
    pagina: null,            // lo que manda la vista previa: { textos:{es,en}, enPagina:[], noEditables:[] }
    previewOk: false, elegir: false, conteo: null, conteoTimer: null, conteoAbierta: "", timer: null, holaTimer: null, busqueda: "",
};
const $e = (id) => document.getElementById(id);
const edG = (o, ...ks) => ks.reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
const edLimpia = (o) => { const r = {}; for (const [k, v] of Object.entries(o || {})) if (v != null && String(v).trim() !== "") r[k] = String(v).trim(); return Object.keys(r).length ? r : undefined; };
const edApi = (accion, extra) => fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, ...extra }) }).then(r => r.json());

// ───────── estructura del modal (se crea la primera vez) ─────────
function edusMontar() {
    if ($e("edus")) return;
    const st = document.createElement("style");
    st.textContent = `
#edus{position:fixed;inset:0;z-index:10050;background:#0b0b0b;color:#eee;display:none;flex-direction:column;font-family:inherit}
#edus.abierto{display:flex}
#edus *{box-sizing:border-box}
#edus label,#edus button,#edus input{text-transform:none;letter-spacing:normal}
#edus table,#edus thead,#edus tbody,#edus tr,#edus th,#edus td{background:transparent !important;color:inherit;border-color:#222}
#edus thead th{color:#888 !important;position:static}
#edus tbody tr:hover{background:#151515 !important}
.edus-top{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #2a2a2a;background:#111;flex-wrap:wrap}
.edus-top h2{margin:0;font-size:16px;color:#C9A84C;letter-spacing:.5px;margin-right:auto;white-space:nowrap}
.edus-b{padding:7px 12px;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#ddd;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
.edus-b:hover{border-color:#C9A84C;color:#C9A84C}
.edus-b.oro{background:#C9A84C;border-color:#C9A84C;color:#111}
.edus-b.oro:disabled{opacity:.45;cursor:default}
.edus-b.on{border-color:#C9A84C;color:#111;background:#e6cc94}
.edus-b.mini{padding:4px 8px;font-size:11px}
#edus-estado{font-size:12px;color:#888}
#edus-estado.sucio{color:#f59e0b}#edus-estado.ok{color:#22c55e}#edus-estado.mal{color:#f87171}
.edus-main{flex:1;display:flex;min-height:0}
.edus-izq{width:min(520px,100%);display:flex;flex-direction:column;border-right:1px solid #2a2a2a;min-height:0}
.edus-tabs{display:flex;gap:4px;padding:8px;overflow-x:auto;border-bottom:1px solid #222;scrollbar-width:none}
.edus-tab{padding:7px 10px;border-radius:7px;border:none;background:none;color:#999;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit}
.edus-tab.activa{background:#1f1a0e;color:#C9A84C}
.edus-cuerpo{flex:1;overflow-y:auto;padding:12px 14px 40px}
.edus-der{flex:1;display:flex;flex-direction:column;min-width:0;background:#1a1a1a}
.edus-der-top{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:11px;color:#888;border-bottom:1px solid #222}
#edus-frame{flex:1;width:100%;border:0;background:#fff}
.edus-h{font-size:13px;font-weight:700;color:#C9A84C;margin:14px 0 6px}
.edus-h:first-child{margin-top:2px}
.edus-nota{font-size:11px;color:#888;margin:0 0 8px;line-height:1.45}
.edus-in,.edus-ta{width:100%;padding:7px 9px;background:#161616;border:1px solid #3a3a3a;border-radius:7px;color:#fff;font-size:13px;font-family:inherit}
.edus-ta{min-height:64px;resize:vertical}
.edus-in:focus,.edus-ta:focus{outline:none;border-color:#C9A84C}
.edus-dos{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.edus-lb{display:block;font-size:10px;color:#888;margin:6px 0 3px;letter-spacing:.5px;text-transform:uppercase}
.edus-caja{border:1px solid #2a2a2a;border-radius:10px;padding:10px;margin-bottom:8px;background:#121212}
.edus-caja.edit{border-color:#6b5a2b}
.edus-caja.brilla{animation:edusBrilla 1.6s ease}
@keyframes edusBrilla{0%,60%{box-shadow:0 0 0 2px #C9A84C}100%{box-shadow:none}}
.edus-cab{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px;font-weight:700;margin-bottom:4px}
.edus-cab small{font-weight:400;color:#666;font-size:10px}
.edus-fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.edus-foto{border:1px solid #2a2a2a;border-radius:10px;padding:6px;background:#121212}
.edus-mini{aspect-ratio:16/10;border-radius:6px;background:#222 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#555;font-size:11px;margin-bottom:5px}
.edus-mini.contain{background-size:contain;background-color:#F7F4EE;aspect-ratio:1/1}
.edus-acc{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;align-items:center}
.edus-acc .st{font-size:10px;color:#888}
.edus-sec{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #2a2a2a;border-radius:10px;margin-bottom:6px;background:#121212}
.edus-sec.off{opacity:.5}
.edus-sec .nom{flex:1;font-size:13px;font-weight:600}
.edus-sec .nom small{display:block;font-weight:400;color:#777;font-size:10px;margin-top:2px}
.edus-chk{display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap}
.edus-tag{font-size:10px;color:#C9A84C;font-weight:700}
@media (max-width:900px){
  .edus-izq{width:100%;border-right:0}
  .edus-der{display:none;position:absolute;inset:0;z-index:2}
  #edus.ver-previa .edus-der{display:flex}
  #edus.ver-previa .edus-izq{display:none}
  .edus-main{position:relative}
}
@media (min-width:901px){ #edus-btn-previa{display:none} }`;
    document.head.appendChild(st);
    const d = document.createElement("div");
    d.id = "edus";
    d.innerHTML = `
<div class="edus-top">
  <h2>✏️ Editar página USA</h2>
  <span id="edus-estado">Cargando…</span>
  <button class="edus-b" id="edus-btn-previa" onclick="edusVerPrevia()">👁️ Vista previa</button>
  <button class="edus-b" onclick="edusDescartar()">↩️ Descartar</button>
  <button class="edus-b oro" id="edus-guardar" onclick="edusGuardar()" disabled>💾 Publicar</button>
  <button class="edus-b" onclick="edusCerrar()" title="Cerrar">✕</button>
</div>
<div class="edus-main">
  <div class="edus-izq">
    <div class="edus-tabs" id="edus-tabs"></div>
    <div class="edus-cuerpo" id="edus-cuerpo"></div>
  </div>
  <div class="edus-der">
    <div class="edus-der-top">
      <span style="margin-right:auto;">Vista previa — los cambios se ven al instante; los clientes los ven al <b>publicar</b>.</span>
      <button class="edus-b mini" id="edus-elegir" onclick="edusElegir()" title="Toca un texto de la vista previa para editarlo">🎯 Tocar un texto</button>
      <button class="edus-b mini" id="edus-lang-es" onclick="edusLang('es')">ES</button>
      <button class="edus-b mini" id="edus-lang-en" onclick="edusLang('en')">EN</button>
      <button class="edus-b mini" onclick="edusRecargarPrevia()" title="Recargar la vista previa">⟳</button>
      <button class="edus-b mini" id="edus-btn-volver" onclick="edusVerPrevia()" style="display:none;">✏️ Volver a editar</button>
    </div>
    <iframe id="edus-frame" title="Vista previa de us.verexstore.com"></iframe>
  </div>
</div>`;
    document.body.appendChild(d);
    window.addEventListener("message", edusMensaje);
    window.addEventListener("beforeunload", (e) => { if (edus.abierto && edus.sucio) { e.preventDefault(); e.returnValue = ""; } });
}

const EDUS_TABS = [["publicados", "📊 Publicados"], ["fotos", "📸 Fotos"], ["textos", "📝 Textos"], ["secciones", "🧩 Secciones"], ["cats", "🗂️ Categorías"], ["faqs", "❓ Preguntas"], ["pols", "📄 Políticas"], ["contacto", "📞 Contacto"]];
function edusPintarTabs() {
    $e("edus-tabs").innerHTML = EDUS_TABS.map(([k, t]) => `<button class="edus-tab${edus.tab === k ? " activa" : ""}" onclick="edusTab('${k}')">${t}</button>`).join("");
}
function edusTab(k) { edus.tab = k; edusPintarTabs(); edusPintar(); $e("edus-cuerpo").scrollTop = 0; }

// ───────── abrir / cargar ─────────
async function abrirEditorUS() {
    if (!ADMIN_PASS) { toast("Primero entra al Admin", "#ef4444"); return; }
    edusMontar();
    $e("edus").classList.add("abierto"); edus.abierto = true; document.body.style.overflow = "hidden";
    edusPintarTabs();
    await edusCargar();
    if (!$e("edus-frame").src) edusRecargarPrevia();
}
function edusCerrar() {
    if (edus.sucio && !confirm("Tienes cambios sin publicar. ¿Cerrar y descartarlos?")) return;
    $e("edus").classList.remove("abierto"); edus.abierto = false; document.body.style.overflow = "";
    edus.sucio = false;
}
async function edusCargar() {
    edusEstado("Cargando…", "");
    let r;
    try { r = await edApi("GET_CONFIG", {}); } catch (e) { r = null; }
    if (!r || !r.config) { edusEstado("⚠️ No se pudo cargar. Revisa tu conexión.", "mal"); $e("edus-cuerpo").innerHTML = ""; return; }
    const b = edus.base = r.config.contenidoUS || {};
    edus.fotos = (Array.isArray(b.heroFotos) && b.heroFotos.length ? b.heroFotos : (b.heroFoto ? [b.heroFoto] : [])).filter(Boolean).slice(0, EDUS_MAX_FOTOS);
    edus.fotosCat = { ...(b.fotosCategorias || {}) };
    edus.textos = {};
    for (const [k, v] of Object.entries(b.textos || {})) edus.textos[k] = { es: (v && v.es) || "", en: (v && v.en) || "" };
    for (const [clave, campo] of Object.entries(EDUS_LEGADO)) if (b[campo] && (b[campo].es || b[campo].en)) edus.textos[clave] = { es: b[campo].es || "", en: b[campo].en || "" };
    const orden = (Array.isArray(b.secciones) ? b.secciones : []).filter(x => x && EDUS_SECCIONES[x.id]);
    edus.secciones = orden.map(x => ({ id: x.id, visible: x.visible !== false })).concat(Object.keys(EDUS_SECCIONES).filter(id => !orden.some(x => x.id === id)).map(id => ({ id, visible: true })));
    const lc = r.config.categorias;
    edus.catsGuardadas = Array.isArray(lc) && lc.length ? lc.map(c => c.codigo) : [];
    edus.cats = (Array.isArray(lc) && lc.length ? lc : EDUS_DEF_CATS).map(c => ({ codigo: c.codigo, es: c.es || "", en: c.en || "", visible: c.visible !== false }));
    edus.catsTocadas = false;
    edus.faqs = (Array.isArray(b.faqs) ? b.faqs : []).map(f => ({ q: { es: edG(f, "q", "es") || "", en: edG(f, "q", "en") || "" }, a: { es: edG(f, "a", "es") || "", en: edG(f, "a", "en") || "" } }));
    edus.pols = {}; for (const p of EDUS_POLS) edus.pols[p.k] = { es: edG(b, "politicas", p.k, "es") || "", en: edG(b, "politicas", p.k, "en") || "" };
    edus.wa = b.whatsapp || "";
    edusSucio(false);
    edusPintar();
    edusPrevia();
}

function edusEstado(t, cls) { const e = $e("edus-estado"); if (e) { e.textContent = t; e.className = cls || ""; } }
function edusSucio(v) {
    edus.sucio = v; $e("edus-guardar").disabled = !v;
    edusEstado(v ? "● Cambios sin publicar" : "Todo publicado", v ? "sucio" : "");
}
function edusCambio() { if (!edus.sucio) edusSucio(true); edusPrevia(); }
function edusDescartar() { if (edus.sucio && !confirm("¿Descartar los cambios sin publicar?")) return; edusCargar(); }

// ───────── lo que se guarda (y lo que ve la vista previa) ─────────
function edusBorrador() {
    const nuevo = { ...edus.base };
    const fotos = edus.fotos.map(x => String(x || "").trim()).filter(Boolean);
    nuevo.heroFotos = fotos.length ? fotos : undefined; nuevo.heroFoto = fotos[0] || undefined;
    const tx = {};
    for (const [k, v] of Object.entries(edus.textos)) {
        const l = edLimpia(v);
        if (EDUS_LEGADO[k]) nuevo[EDUS_LEGADO[k]] = l;
        else if (l) tx[k] = l;
    }
    for (const [clave, campo] of Object.entries(EDUS_LEGADO)) if (!edus.textos[clave]) nuevo[campo] = undefined;
    nuevo.textos = Object.keys(tx).length ? tx : undefined;
    const vistaFabrica = edus.secciones.every((s, i) => s.visible && s.id === Object.keys(EDUS_SECCIONES)[i]);
    nuevo.secciones = vistaFabrica ? undefined : edus.secciones.map(s => ({ id: s.id, visible: !!s.visible }));
    const fc = {}; for (const [k, v] of Object.entries(edus.fotosCat)) if (v && String(v).trim()) fc[k] = String(v).trim();
    nuevo.fotosCategorias = Object.keys(fc).length ? fc : undefined;
    const fq = edus.faqs.map(f => ({ q: edLimpia(f.q), a: edLimpia(f.a) })).filter(f => f.q && f.a);
    nuevo.faqs = fq.length ? fq : undefined;
    const pol = {}; for (const p of EDUS_POLS) { const v = edLimpia(edus.pols[p.k]); if (v) pol[p.k] = v; }
    nuevo.politicas = Object.keys(pol).length ? pol : undefined;
    const wa = String(edus.wa || "").replace(/\D/g, "");
    nuevo.whatsapp = wa || undefined;
    for (const k of Object.keys(nuevo)) if (nuevo[k] === undefined) delete nuevo[k];
    return nuevo;
}
function edusCatsParaGuardar() {
    return edus.cats.map(c => ({ codigo: c.codigo, es: c.es.trim(), en: (c.en || "").trim() || c.es.trim(), visible: !!c.visible }));
}
function edusCatsValidar() {
    const vistos = new Set();
    for (const c of edus.cats) {
        if (!/^[A-Z]{2}$/.test(c.codigo)) return `La categoría «${c.es || "sin nombre"}» necesita un código de 2 letras.`;
        if (vistos.has(c.codigo)) return `El código ${c.codigo} está repetido.`; vistos.add(c.codigo);
        if (!c.es.trim()) return `La categoría ${c.codigo} necesita un nombre en español.`;
    }
    return "";
}

async function edusGuardar() {
    const b = $e("edus-guardar"); b.disabled = true; edusEstado("Publicando…", "");
    try {
        const wa = String(edus.wa || "").replace(/\D/g, "");
        if (String(edus.wa || "").trim() && wa.length < 8) throw new Error("El número de WhatsApp parece incompleto (incluye el código de país).");
        // lo último guardado (por si alguien cambió algo desde otro lado): solo se pisan los campos de este editor
        const fresco = (await edApi("GET_CONFIG", {})).config || {};
        edus.base = { ...(fresco.contenidoUS || {}) };
        const nuevo = edusBorrador();
        const cfgGuardar = { contenidoUS: nuevo };
        if (edus.catsTocadas || (Array.isArray(fresco.categorias) && fresco.categorias.length)) {
            const e = edusCatsValidar(); if (e) throw new Error(e);
            cfgGuardar.categorias = edusCatsParaGuardar();
        }
        const r = await edApi("GUARDAR_CONFIG", { _pass: ADMIN_PASS, config: cfgGuardar });
        if (!r || !r.ok) throw new Error((r && r.error) || "No se pudo publicar (¿la sesión expiró?)");
        edus.base = nuevo;
        // el Admin guarda su config completa en otros botones: que lleve ya lo nuevo y no lo pise
        cfg.contenidoUS = nuevo; if (cfgGuardar.categorias) cfg.categorias = cfgGuardar.categorias;
        try { localStorage.setItem("vx_cfg", JSON.stringify(cfg)); } catch (_) {}
        if (cfgGuardar.categorias) { edus.catsGuardadas = cfgGuardar.categorias.map(c => c.codigo); edus.catsTocadas = false; }
        edusSucio(false); edusEstado("✅ Publicado — los clientes lo ven al recargar la página", "ok");
        toast("✅ Página USA publicada", "#22c55e");
    } catch (e) {
        edusEstado("⚠️ " + (e.message || e), "mal"); b.disabled = false;
    }
}

// ───────── vista previa ─────────
function edusRecargarPrevia() {
    edus.previewOk = false;
    $e("edus-frame").src = EDUS_PREVIEW_URL + "&t=" + Date.now();
    clearInterval(edus.holaTimer);
    let n = 0;
    edus.holaTimer = setInterval(() => {
        if (edus.previewOk || ++n > 30) { clearInterval(edus.holaTimer); return; }
        try { $e("edus-frame").contentWindow.postMessage({ type: "vx-editor-hola" }, EDUS_PREVIEW_ORIGEN); } catch (_) {}
    }, 700);
}
function edusPrevia(irA) {
    clearTimeout(edus.timer);
    edus.timer = setTimeout(() => {
        if (!edus.previewOk) return;
        const msg = { type: "vx-editor-preview", contenidoUS: edusBorrador(), categorias: edusCatsParaGuardar(), lang: edus.lang };
        if (irA) msg.irA = irA;
        $e("edus-frame").contentWindow.postMessage(msg, EDUS_PREVIEW_ORIGEN);
    }, irA ? 0 : 250);
}
function edusMensaje(e) {
    if (e.origin !== EDUS_PREVIEW_ORIGEN || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "vx-editor-listo") {
        edus.previewOk = true; clearInterval(edus.holaTimer);
        const d = e.data;
        edus.pagina = { textos: d.textos || { es: {}, en: {} }, enPagina: d.enPagina || [], noEditables: d.noEditables || [] };
        if (edus.tab === "textos") edusPintar();
        edusPrevia();
        edusPedirConteo();
        if (edus.elegir) $e("edus-frame").contentWindow.postMessage({ type: "vx-editor-elegir", on: true }, EDUS_PREVIEW_ORIGEN);
    } else if (e.data.type === "vx-editor-conteo") {
        clearTimeout(edus.conteoTimer);
        if (e.data.cargando) { edus.conteoTimer = setTimeout(edusPedirConteo, 1000); return; }
        edus.conteo = { items: Array.isArray(e.data.items) ? e.data.items : [], nombres: e.data.nombres || {}, visibles: e.data.visibles || [], registros: e.data.registros || 0, hora: new Date() };
        if (edus.tab === "publicados") edusPintar();
    } else if (e.data.type === "vx-editor-elegido" && typeof e.data.clave === "string") {
        if (edus.elegir) edusElegir();          // un toque = un texto: se apaga solo y el cursor queda en su campo
        edusIrATexto(e.data.clave);
    }
}
function edusLang(l) {
    edus.lang = l;
    $e("edus-lang-es").classList.toggle("on", l === "es"); $e("edus-lang-en").classList.toggle("on", l === "en");
    edusPrevia();
}
function edusElegir() {
    edus.elegir = !edus.elegir;
    $e("edus-elegir").classList.toggle("on", edus.elegir);
    if (edus.previewOk) $e("edus-frame").contentWindow.postMessage({ type: "vx-editor-elegir", on: edus.elegir }, EDUS_PREVIEW_ORIGEN);
}
function edusVerPrevia() {
    const on = $e("edus").classList.toggle("ver-previa");
    $e("edus-btn-volver").style.display = on ? "" : "none";
}
function edusIrATexto(clave) {
    if (!edus.pagina || !(clave in edus.pagina.textos.es)) return;
    if ($e("edus").classList.contains("ver-previa")) edusVerPrevia();
    edus.busqueda = ""; edusTab("textos");
    const caja = document.querySelector(`[data-edus-clave="${CSS.escape(clave)}"]`);
    if (!caja) { toast("Ese texto no se puede editar aquí", "#f59e0b"); return; }
    caja.scrollIntoView({ block: "center" });
    caja.classList.remove("brilla"); void caja.offsetWidth; caja.classList.add("brilla");
    const inp = caja.querySelector(`[data-l="${edus.lang}"]`); if (inp) inp.focus();
}

// ───────── pestañas ─────────
function edusPintar() {
    const c = $e("edus-cuerpo"); if (!c) return;
    const f = { publicados: edusPPublicados, fotos: edusPFotos, textos: edusPTextos, secciones: edusPSecciones, cats: edusPCats, faqs: edusPFaqs, pols: edusPPols, contacto: edusPContacto }[edus.tab];
    c.innerHTML = f ? f() : "";
}

// Fotos
function edusPFotos() {
    const slots = edus.fotos.concat(edus.fotos.length < EDUS_MAX_FOTOS ? [""] : []);
    const cats = edus.cats.filter(c => c.visible);
    return `
<div class="edus-h">Portada — hasta ${EDUS_MAX_FOTOS} fotos</div>
<p class="edus-nota">Se pasan solas cada 5 segundos (con flechas y puntos). Con una sola foto no hay carrusel. Medida ideal: <b>2000 × 1667 px</b>, horizontal, producto centrado. Sin ninguna, queda la foto de siempre.</p>
<div class="edus-fotos">${slots.map((u, i) => `
  <div class="edus-foto">
    <div class="edus-mini" style="${u ? `background-image:url('${esc(u)}')` : ""}">${u ? "" : (i === 0 ? "Foto de siempre" : "+ Foto " + (i + 1))}</div>
    <input class="edus-in" placeholder="Foto ${i + 1}: pega la dirección o sube" value="${esc(u)}" onchange="edusFoto(${i}, this.value)">
    <div class="edus-acc">
      <label class="edus-b mini" style="cursor:pointer;">📤 Subir<input type="file" accept="image/*" hidden onchange="edusSubir('hero', ${i}, this.files[0]); this.value=''"></label>
      ${u ? `<button class="edus-b mini" onclick="edusFotoMover(${i}, -1)" ${i === 0 ? "disabled" : ""} title="Antes">←</button>
      <button class="edus-b mini" onclick="edusFotoMover(${i}, 1)" ${i >= edus.fotos.length - 1 ? "disabled" : ""} title="Después">→</button>
      <button class="edus-b mini" onclick="edusFoto(${i}, '')" title="Quitar">✕</button>` : ""}
      <span class="st" id="edus-st-hero-${i}"></span>
    </div>
  </div>`).join("")}
</div>
<div class="edus-h">Fotos de «Comprar por categoría»</div>
<p class="edus-nota">Vacío = automática (la foto del primer producto de esa categoría). Se muestra completa, sin recortar.</p>
<div class="edus-fotos">${cats.map(c => { const u = edus.fotosCat[c.codigo] || ""; return `
  <div class="edus-foto">
    <div class="edus-mini contain" style="${u ? `background-image:url('${esc(u)}')` : ""}">${u ? "" : "Automática"}</div>
    <div style="font-size:12px;font-weight:700;margin-bottom:4px;">${esc(c.es || c.codigo)}</div>
    <input class="edus-in" placeholder="Dirección de la foto" value="${esc(u)}" onchange="edusFotoCat('${c.codigo}', this.value)">
    <div class="edus-acc">
      <label class="edus-b mini" style="cursor:pointer;">📤 Subir<input type="file" accept="image/*" hidden onchange="edusSubir('cat', '${c.codigo}', this.files[0]); this.value=''"></label>
      ${u ? `<button class="edus-b mini" onclick="edusFotoCat('${c.codigo}', '')">↺ Automática</button>` : ""}
      <span class="st" id="edus-st-cat-${c.codigo}"></span>
    </div>
  </div>`; }).join("")}
</div>`;
}
function edusFoto(i, v) {
    v = String(v || "").trim();
    if (v && !/^https:\/\//i.test(v)) { toast("La dirección de la foto debe empezar con https://", "#f59e0b"); edusPintar(); return; }
    if (v) edus.fotos[i] = v; else edus.fotos.splice(i, 1);
    edus.fotos = edus.fotos.filter(Boolean).slice(0, EDUS_MAX_FOTOS);
    edusPintar(); edusCambio(); edusPrevia("hero");
}
function edusFotoMover(i, d) { const j = i + d; if (j < 0 || j >= edus.fotos.length) return; [edus.fotos[i], edus.fotos[j]] = [edus.fotos[j], edus.fotos[i]]; edusPintar(); edusCambio(); }
function edusFotoCat(c, v) {
    v = String(v || "").trim();
    if (v && !/^https:\/\//i.test(v)) { toast("La dirección de la foto debe empezar con https://", "#f59e0b"); edusPintar(); return; }
    if (v) edus.fotosCat[c] = v; else delete edus.fotosCat[c];
    edusPintar(); edusCambio(); edusPrevia("categorias");
}
function edusReducir(file, maxPx) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = rej; fr.onload = () => { const im = new Image(); im.onerror = () => rej(new Error("No es una imagen válida")); im.onload = () => {
        const k = Math.min(1, maxPx / Math.max(im.width, im.height)), w = Math.round(im.width * k), h = Math.round(im.height * k);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, w, h);
        res({ b64: cv.toDataURL("image/jpeg", 0.88), w, h }); }; im.src = fr.result; }; fr.readAsDataURL(file); });
}
async function edusSubir(tipo, i, file) {
    if (!file) return;
    const st = () => $e(`edus-st-${tipo}-${i}`);
    const msg = (t) => { const s = st(); if (s) s.textContent = t; };
    msg("Preparando…");
    try {
        const r = await edusReducir(file, tipo === "hero" ? 2000 : 900);
        msg(`Subiendo (${r.w}×${r.h})…`);
        const j = await edApi("SUBIR_FOTO", { _pass: ADMIN_PASS, imagen: r.b64, nombre: (tipo === "hero" ? "hero_" : "cat_" + i + "_") + Date.now(), original: true });
        if (!j.ok || !j.url) throw new Error(j.error || "no se pudo subir");
        if (tipo === "hero") edusFoto(Math.min(i, edus.fotos.length), j.url); else edusFotoCat(i, j.url);
        msg(tipo === "hero" && r.w / r.h < 1.05 ? "✅ Subida · es casi cuadrada: se recortará arriba y abajo" : "✅ Subida");
    } catch (e) { msg("⚠️ " + (e.message || e)); }
}

// Textos
function edusPTextos() {
    if (!edus.pagina) return `<p class="edus-nota">Cargando los textos desde la vista previa… Si no aparecen, toca ⟳ arriba de la vista previa.</p>`;
    const P = edus.pagina, no = new Set(P.noEditables), enPag = new Set(P.enPagina);
    const claves = Object.keys(P.textos.es).filter(k => !no.has(k));
    const q = edus.busqueda.toLowerCase().trim();
    const coincide = (k) => !q || [k, P.textos.es[k], P.textos.en[k], edG(edus.textos, k, "es"), edG(edus.textos, k, "en")].some(x => String(x || "").toLowerCase().includes(q));
    const fila = (k) => {
        const v = edus.textos[k] || { es: "", en: "" }, dEs = P.textos.es[k] || "", dEn = P.textos.en[k] || "";
        const largo = Math.max(dEs.length, dEn.length) > 70;
        const campo = (l, d) => largo
            ? `<textarea class="edus-ta" data-l="${l}" placeholder="${esc(d)}" oninput="edusTexto('${k}','${l}',this.value)">${esc(v[l])}</textarea>`
            : `<input class="edus-in" data-l="${l}" placeholder="${esc(d)}" value="${esc(v[l])}" oninput="edusTexto('${k}','${l}',this.value)">`;
        const editado = v.es || v.en;
        return `<div class="edus-caja${editado ? " edit" : ""}" data-edus-clave="${esc(k)}">
  <div class="edus-cab"><span>${esc(dEs.length > 60 ? dEs.slice(0, 60) + "…" : dEs)} <small>${esc(k)}</small></span>
  ${editado ? `<button class="edus-b mini" onclick="edusTextoReset('${k}')" title="Volver al texto original">↺</button>` : ""}</div>
  <div class="edus-dos"><div><span class="edus-lb">Español</span>${campo("es", dEs)}</div><div><span class="edus-lb">English</span>${campo("en", dEn)}</div></div>
</div>`;
    };
    const grupo = (titulo, lista) => lista.length ? `<div class="edus-h">${titulo} (${lista.length})</div>` + lista.map(fila).join("") : "";
    const a = claves.filter(k => enPag.has(k) && coincide(k)), b = claves.filter(k => !enPag.has(k) && coincide(k));
    const nEd = Object.values(edus.textos).filter(v => v.es || v.en).length;
    return `
<input class="edus-in" id="edus-buscar" placeholder="🔎 Buscar un texto (en español o inglés)…" value="${esc(edus.busqueda)}" oninput="edusBuscar(this.value)">
<p class="edus-nota" style="margin-top:6px;">Vacío = queda el texto original (se ve en gris). ${nEd ? `<span class="edus-tag">${nEd} editado${nEd === 1 ? "" : "s"}</span>` : ""} También puedes tocar <b>🎯 Tocar un texto</b> y hacer clic en la vista previa.</p>
${grupo("En la página", a)}${grupo("Carrito, pedido y avisos", b)}
${!a.length && !b.length ? '<p class="edus-nota">Nada coincide con la búsqueda.</p>' : ""}`;
}
function edusTexto(k, l, v) {
    const t = edus.textos[k] || (edus.textos[k] = { es: "", en: "" });
    t[l] = v;
    if (!t.es && !t.en) delete edus.textos[k];
    const caja = document.querySelector(`[data-edus-clave="${CSS.escape(k)}"]`); if (caja) caja.classList.toggle("edit", !!(t.es || t.en));
    edusCambio();
}
function edusTextoReset(k) { delete edus.textos[k]; edusPintar(); edusCambio(); }
function edusBuscar(v) {
    edus.busqueda = v; edusPintar();
    const i = $e("edus-buscar"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
}

// Secciones
function edusPSecciones() {
    return `
<div class="edus-h">Orden y visibilidad del inicio</div>
<p class="edus-nota">Mueve con ↑ ↓ y apaga lo que no quieras mostrar. El catálogo completo siempre va al final.</p>
${edus.secciones.map((s, i) => { const S = EDUS_SECCIONES[s.id]; return `
<div class="edus-sec${s.visible ? "" : " off"}">
  <div class="nom">${S.t}${S.nota ? `<small>${S.nota}</small>` : ""}</div>
  <label class="edus-chk"><input type="checkbox" ${s.visible ? "checked" : ""} onchange="edusSecVer(${i}, this.checked)"> Visible</label>
  <button class="edus-b mini" onclick="edusSecMover(${i}, -1)" ${i === 0 ? "disabled" : ""}>↑</button>
  <button class="edus-b mini" onclick="edusSecMover(${i}, 1)" ${i === edus.secciones.length - 1 ? "disabled" : ""}>↓</button>
  <button class="edus-b mini" onclick="edusPrevia('${s.id}')" title="Ver en la vista previa">👁️</button>
</div>`; }).join("")}
<div class="edus-sec" style="opacity:.6;"><div class="nom">🛍️ Catálogo completo<small>Siempre visible, al final.</small></div></div>
<button class="edus-b mini" onclick="edusSecFabrica()" style="margin-top:6px;">↺ Volver al orden de siempre</button>`;
}
function edusSecVer(i, v) {
    if (!v && edus.secciones.filter(s => s.visible).length <= 1) { toast("Deja al menos una sección visible", "#f59e0b"); edusPintar(); return; }
    edus.secciones[i].visible = v; edusPintar(); edusCambio();
}
function edusSecMover(i, d) { const j = i + d; if (j < 0 || j >= edus.secciones.length) return; [edus.secciones[i], edus.secciones[j]] = [edus.secciones[j], edus.secciones[i]]; edusPintar(); edusCambio(); edusPrevia(edus.secciones[j].id); }
function edusSecFabrica() { edus.secciones = Object.keys(EDUS_SECCIONES).map(id => ({ id, visible: true })); edusPintar(); edusCambio(); }

// Categorías
function edusPCats() {
    return `
<div class="edus-h">Categorías de la tienda</div>
<p class="edus-nota">Nombre de cada tarjeta y botón del menú, orden y si se muestra. Quitar una categoría NO borra sus productos.</p>
${edus.cats.map((c, i) => { const fija = edus.catsGuardadas.includes(c.codigo) || EDUS_DEF_CATS.some(d => d.codigo === c.codigo); return `
<div class="edus-caja">
  <div class="edus-cab"><span>${esc(c.es) || "Nueva categoría"}</span><span>
    <button class="edus-b mini" onclick="edusCatMover(${i}, -1)" ${i === 0 ? "disabled" : ""}>↑</button>
    <button class="edus-b mini" onclick="edusCatMover(${i}, 1)" ${i === edus.cats.length - 1 ? "disabled" : ""}>↓</button>
    <button class="edus-b mini" onclick="edusCatBorrar(${i})">🗑️</button></span></div>
  <div class="edus-dos">
    <div><span class="edus-lb">Código (2 letras)</span><input class="edus-in" maxlength="2" value="${esc(c.codigo)}" ${fija ? 'disabled title="El código de una categoría existente no se cambia (los productos ya lo usan)"' : ""} oninput="this.value=this.value.toUpperCase().replace(/[^A-Z]/g,''); edusCatSet(${i},'codigo',this.value)"></div>
    <div><span class="edus-lb">Visible</span><label class="edus-chk" style="margin-top:8px;"><input type="checkbox" ${c.visible ? "checked" : ""} onchange="edusCatSet(${i},'visible',this.checked)"> Tarjeta y botón</label></div>
    <div><span class="edus-lb">Nombre (ES)</span><input class="edus-in" value="${esc(c.es)}" oninput="edusCatSet(${i},'es',this.value)"></div>
    <div><span class="edus-lb">Name (EN)</span><input class="edus-in" value="${esc(c.en)}" oninput="edusCatSet(${i},'en',this.value)"></div>
  </div>
</div>`; }).join("")}
<button class="edus-b" onclick="edusCatAgregar()">+ Agregar categoría</button>`;
}
function edusCatSet(i, k, v) { edus.cats[i][k] = v; edus.catsTocadas = true; edusCambio(); }
function edusCatAgregar() { edus.cats.push({ codigo: "", es: "", en: "", visible: true }); edus.catsTocadas = true; edusPintar(); edusCambio(); }
function edusCatBorrar(i) { if (!confirm("¿Quitar esta categoría de la tienda? Los productos NO se borran: solo deja de mostrarse su tarjeta y su botón.")) return; edus.cats.splice(i, 1); edus.catsTocadas = true; edusPintar(); edusCambio(); }
function edusCatMover(i, d) { const j = i + d; if (j < 0 || j >= edus.cats.length) return; [edus.cats[i], edus.cats[j]] = [edus.cats[j], edus.cats[i]]; edus.catsTocadas = true; edusPintar(); edusCambio(); }

// Preguntas frecuentes
function edusPFaqs() {
    return `
<div class="edus-h">Preguntas frecuentes</div>
<p class="edus-nota">Se ven en el pie de la página y Lyra las usa para responder. Escribe <b>{guia}</b> para poner el botón de la guía de tallas. ${edus.faqs.length ? "" : "Ahora mismo la tienda usa las suyas de siempre."}</p>
${edus.faqs.map((f, i) => `
<div class="edus-caja">
  <div class="edus-cab"><span>Pregunta ${i + 1}</span><span>
    <button class="edus-b mini" onclick="edusFaqMover(${i}, -1)" ${i === 0 ? "disabled" : ""}>↑</button>
    <button class="edus-b mini" onclick="edusFaqMover(${i}, 1)" ${i === edus.faqs.length - 1 ? "disabled" : ""}>↓</button>
    <button class="edus-b mini" onclick="edusFaqBorrar(${i})">🗑️</button></span></div>
  <div class="edus-dos">
    <div><span class="edus-lb">Pregunta (ES)</span><input class="edus-in" value="${esc(f.q.es)}" oninput="edusFaqSet(${i},'q','es',this.value)"></div>
    <div><span class="edus-lb">Question (EN)</span><input class="edus-in" value="${esc(f.q.en)}" oninput="edusFaqSet(${i},'q','en',this.value)"></div>
    <div><span class="edus-lb">Respuesta (ES)</span><textarea class="edus-ta" oninput="edusFaqSet(${i},'a','es',this.value)">${esc(f.a.es)}</textarea></div>
    <div><span class="edus-lb">Answer (EN)</span><textarea class="edus-ta" oninput="edusFaqSet(${i},'a','en',this.value)">${esc(f.a.en)}</textarea></div>
  </div>
</div>`).join("")}
<div style="display:flex;gap:6px;flex-wrap:wrap;">
  <button class="edus-b" onclick="edusFaqAgregar()">+ Agregar pregunta</button>
  <button class="edus-b" onclick="edusFaqActuales()">📥 Cargar las de la tienda para editarlas</button>
</div>`;
}
function edusFaqSet(i, c, l, v) { edus.faqs[i][c][l] = v; edusCambio(); }
function edusFaqAgregar() { edus.faqs.push({ q: { es: "", en: "" }, a: { es: "", en: "" } }); edusPintar(); edusCambio(); }
function edusFaqBorrar(i) { if (!confirm("¿Borrar esta pregunta?")) return; edus.faqs.splice(i, 1); edusPintar(); edusCambio(); }
function edusFaqMover(i, d) { const j = i + d; if (j < 0 || j >= edus.faqs.length) return; [edus.faqs[i], edus.faqs[j]] = [edus.faqs[j], edus.faqs[i]]; edusPintar(); edusCambio(); }
function edusFaqActuales() {
    if (edus.faqs.some(f => f.q.es || f.a.es || f.q.en || f.a.en) && !confirm("Esto reemplaza las preguntas que tienes aquí. ¿Continuar?")) return;
    edus.faqs = EDUS_DEF.faqs.es.map((f, i) => ({ q: { es: f.q, en: (EDUS_DEF.faqs.en[i] || {}).q || "" }, a: { es: f.a, en: (EDUS_DEF.faqs.en[i] || {}).a || "" } }));
    edusPintar(); edusCambio();
}

// Políticas
function edusPPols() {
    return `
<div class="edus-h">Textos de las pestañas del pie</div>
<p class="edus-nota">Vacío = queda el texto de siempre. Líneas que empiezan con «- » se ven como viñetas; una línea en blanco separa párrafos.</p>
${EDUS_POLS.map(p => { const v = edus.pols[p.k]; return `
<div class="edus-caja${v.es || v.en ? " edit" : ""}">
  <div class="edus-cab"><span>${p.t}</span><span>
    <button class="edus-b mini" onclick="edusPolCargar('${p.k}')">📥 Cargar texto actual</button>
    ${v.es || v.en ? `<button class="edus-b mini" onclick="edusPolVaciar('${p.k}')" title="Volver al texto de siempre">↺</button>` : ""}</span></div>
  ${p.nota ? `<p class="edus-nota">${p.nota}</p>` : ""}
  <div class="edus-dos">
    <div><span class="edus-lb">Español</span><textarea class="edus-ta" style="min-height:110px;" oninput="edusPolSet('${p.k}','es',this.value)">${esc(v.es)}</textarea></div>
    <div><span class="edus-lb">English</span><textarea class="edus-ta" style="min-height:110px;" oninput="edusPolSet('${p.k}','en',this.value)">${esc(v.en)}</textarea></div>
  </div>
</div>`; }).join("")}`;
}
function edusPolSet(k, l, v) { edus.pols[k][l] = v; edusCambio(); }
function edusPolCargar(k) { const v = edus.pols[k]; if ((v.es || v.en) && !confirm("Esto reemplaza lo que hay escrito. ¿Continuar?")) return; edus.pols[k] = { es: EDUS_DEF.pol[k].es, en: EDUS_DEF.pol[k].en }; edusPintar(); edusCambio(); }
function edusPolVaciar(k) { edus.pols[k] = { es: "", en: "" }; edusPintar(); edusCambio(); }

// Contacto
function edusPContacto() {
    return `
<div class="edus-h">WhatsApp de la tienda USA</div>
<p class="edus-nota">Con código de país, solo números (ej. 50371250725). Vacío = el de siempre.</p>
<input class="edus-in" inputmode="tel" value="${esc(edus.wa)}" placeholder="50371250725" oninput="edus.wa=this.value; edusCambio()">`;
}

// Publicados: lo que ve el cliente, contado por la propia página (vista previa) — una tarjeta = una pieza
function edusPedirConteo() {
    if (!edus.previewOk) return;
    $e("edus-frame").contentWindow.postMessage({ type: "vx-editor-conteo" }, EDUS_PREVIEW_ORIGEN);
}
function edusActualizarConteo() { edus.conteo = null; edusPintar(); edusRecargarPrevia(); }
function edusVerPieza(codigo) {
    if (!edus.previewOk) return;
    $e("edus-frame").contentWindow.postMessage({ type: "vx-editor-ir", codigo }, EDUS_PREVIEW_ORIGEN);
    if (window.innerWidth <= 900 && !$e("edus").classList.contains("ver-previa")) edusVerPrevia();
}
function edusAbrirCat(c) { edus.conteoAbierta = edus.conteoAbierta === c ? "" : c; edusPintar(); }
function edusPPublicados() {
    const C = edus.conteo;
    if (!C) return `<div class="edus-h">Productos publicados en la página</div><p class="edus-nota">Contando lo que ve el cliente en la vista previa…</p>`;
    const porCat = {};
    for (const it of C.items) (porCat[it.cat || ""] = porCat[it.cat || ""] || []).push(it);
    const orden = edus.cats.map(c => c.codigo).concat(Object.keys(porCat).filter(k => k && !edus.cats.some(c => c.codigo === k)).sort());
    if (porCat[""]) orden.push("");
    const nombre = k => k === "" ? "Sin categoría" : ((edus.cats.find(c => c.codigo === k) || {}).es || C.nombres[k] || k);
    const cuenta = l => ({ total: l.length, stock: l.filter(x => !x.agotado).length, agot: l.filter(x => x.agotado).length, dest: l.filter(x => x.destacado).length });
    const tot = cuenta(C.items);
    const limite = parseInt(cfg.limiteCatalogo) || 0;
    const td = "padding:7px 6px;border-bottom:1px solid #222;text-align:center;";
    const fila = k => {
        const l = porCat[k] || [], n = cuenta(l), abierta = edus.conteoAbierta === k;
        const oculta = k && !C.visibles.includes(k);
        const det = abierta ? `<tr><td colspan="5" style="padding:4px 0 10px;">${l.length ? l.map(x => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid #1c1c1c;">
            <div class="edus-mini contain" style="width:38px;min-width:38px;margin:0;${x.foto ? `background-image:url('${esc(x.foto)}')` : ""}"></div>
            <div style="flex:1;min-width:0;font-size:12px;"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(x.nombre)}</div>
              <div style="color:#777;font-size:10px;">${esc(x.codigo)}${x.precio ? " · $" + esc(x.precio) : ""}${x.destacado ? ' · <span style="color:#C9A84C;">⭐ destacada</span>' : ""}${x.agotado ? ' · <span style="color:#f87171;">agotada</span>' : ""}</div></div>
            <button class="edus-b mini" onclick="edusVerPieza('${esc(x.codigo)}')" title="Ver en la vista previa">👁️</button>
          </div>`).join("") : '<div class="edus-nota" style="padding:6px;">Ninguna pieza publicada en esta categoría.</div>'}</td></tr>` : "";
        return `<tr onclick="edusAbrirCat('${k}')" style="cursor:pointer;${abierta ? "background:#1a160c;" : ""}">
          <td style="${td}text-align:left;">${abierta ? "▾" : "▸"} <b>${esc(nombre(k))}</b>${oculta ? ' <span style="color:#777;font-size:10px;">(sin tarjeta en el inicio)</span>' : ""}</td>
          <td style="${td}font-weight:700;color:${n.total ? "#C9A84C" : "#666"};font-size:15px;">${n.total}</td>
          <td style="${td}color:#22c55e;">${n.stock}</td><td style="${td}color:${n.agot ? "#f87171" : "#666"};">${n.agot}</td><td style="${td}">${n.dest}</td></tr>${det}`;
    };
    return `
<div class="edus-h" style="display:flex;justify-content:space-between;align-items:center;">Productos publicados en la página <button class="edus-b mini" onclick="edusActualizarConteo()">⟳ Actualizar</button></div>
<p class="edus-nota">Contado igual que lo ve el cliente: un anillo con varias tallas es <b>una</b> pieza. Toca una categoría para ver sus piezas. Se publica o se quita una pieza marcándola «en catálogo» en Nexus.</p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;">
  <div class="edus-caja" style="text-align:center;margin:0;"><div style="font-size:22px;font-weight:700;color:#C9A84C;">${tot.total}</div><div class="edus-nota" style="margin:0;">en la página</div></div>
  <div class="edus-caja" style="text-align:center;margin:0;"><div style="font-size:22px;font-weight:700;color:#22c55e;">${tot.stock}</div><div class="edus-nota" style="margin:0;">con stock</div></div>
  <div class="edus-caja" style="text-align:center;margin:0;"><div style="font-size:22px;font-weight:700;color:${tot.agot ? "#f87171" : "#666"};">${tot.agot}</div><div class="edus-nota" style="margin:0;">agotadas</div></div>
</div>
${limite && C.registros >= limite ? `<p class="edus-nota" style="color:#f59e0b;">⚠️ Tienes un límite de ${limite} productos en el catálogo (Admin → Dashboard): la página no muestra más que eso aunque haya más marcados.</p>` : ""}
<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead><tr style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:.5px;">
    <th style="${td}text-align:left;">Categoría</th><th style="${td}">En la página</th><th style="${td}">Con stock</th><th style="${td}">Agotadas</th><th style="${td}">⭐ Destac.</th></tr></thead>
  <tbody>${orden.map(fila).join("")}
  <tr style="font-weight:700;"><td style="${td}text-align:left;">Total</td><td style="${td}color:#C9A84C;">${tot.total}</td><td style="${td}">${tot.stock}</td><td style="${td}">${tot.agot}</td><td style="${td}">${tot.dest}</td></tr></tbody>
</table>
<p class="edus-nota" style="margin-top:8px;">Actualizado ${C.hora.toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit" })}</p>`;
}
