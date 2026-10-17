// Pedidos USA: número corto, total calculado en el servidor, correos y avisos
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { fetchResend } from "./avisos.js";
import { _esPiezaB } from "./codigos.js";

// Aviso interno por correo al equipo (pedidos USA que requieren atención).
export async function avisarAdminUSA(env, asunto, htmlCuerpo) {
  const RESEND_KEY = env.RESEND_KEY;
  if (!RESEND_KEY) return;
  try {
    await fetchResend("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: "VEREX Store <hola@notificaciones.verexstore.com>",
        reply_to: "hola@verexstore.com",
        to: ["verex.pedidos@verexstore.com"],
        subject: asunto,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:2px solid #e74c3c;border-radius:12px;">${htmlCuerpo}</div>`
      })
    });
  } catch (e) { console.error("avisarAdminUSA:", e); }
}

// Correo al cliente cuando se agrega el tracking de DHL de su pedido. Se manda UNO por
// pedido: el panel actualiza todos los productos a la vez (peticiones paralelas), así que
// solo lo dispara el primer lead del grupo (por id) para no duplicarlo.
export async function enviarCorreoEnvioUSA(env, sb, lead, tracking) {
  const RESEND_KEY = env.RESEND_KEY;
  if (!RESEND_KEY) return;
  try {
    const todos = await sb.getAll("leads");
    const grupo = lead.pedidoId ? todos.filter(l => l.pedidoId === lead.pedidoId && l.pais === "US") : [lead];
    const idsOrdenados = grupo.map(l => String(l.id)).sort();
    if (idsOrdenados.length && String(lead.id) !== idsOrdenados[0]) return;   // lo manda otro lead del grupo
    if (grupo.some(l => l.correoEnvioEnviado)) return;
    const correo = lead.correoCliente || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return;
    const trk = String(tracking || "").replace(/[^A-Za-z0-9 \-]/g, "").trim();
    if (!trk) return;
    const en = lead.lang === "en";
    const nombre = lead.nombreCliente || "";
    const linkTrk = `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(trk.replace(/\s+/g, ""))}`;
    const txt = en ? {
      subject: `📦 Your VEREX Store order${lead.numeroPedidoUSA ? " " + lead.numeroPedidoUSA : ""} has shipped`,
      pre: "Your order is on its way",
      hola: `Hi ${nombre},`,
      msg: "Your order has shipped via DHL — delivery takes 5–7 business days.",
      lbl: "DHL tracking number", btn: "Track my package", dudas: "Questions? Just reply to this email."
    } : {
      subject: `📦 Tu pedido de VEREX Store${lead.numeroPedidoUSA ? " " + lead.numeroPedidoUSA : ""} ya fue enviado`,
      pre: "Tu pedido va en camino",
      hola: `Hola ${nombre},`,
      msg: "Tu pedido ya salió por DHL — la entrega toma de 5 a 7 días hábiles.",
      lbl: "Número de tracking DHL", btn: "Rastrear mi paquete", dudas: "¿Dudas? Responde este correo."
    };
    await fetchResend("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: "VEREX Store <hola@notificaciones.verexstore.com>",
        reply_to: "hola@verexstore.com",
        to: [correo],
        subject: txt.subject,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
              <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#444;">${txt.pre}</p>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 16px;font-size:15px;color:#111;">${txt.hola}</p>
              <p style="margin:0 0 16px;font-size:14px;color:#444;">${txt.msg}</p>
              <p style="margin:0 0 4px;font-size:12px;color:#888;">${txt.lbl}</p>
              <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#111;">${trk}</p>
              <p style="margin:0 0 16px;text-align:center;"><a href="${linkTrk}" style="display:inline-block;padding:12px 22px;background:#C9A84C;color:#111;font-weight:700;text-decoration:none;border-radius:8px;">${txt.btn}</a></p>
              <p style="margin:20px 0 0;font-size:13px;color:#444;">${txt.dudas}</p>
            </div>
            <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">El mundo es mejor cuando brillas tú ✨</div>
          </div>`
      })
    });
    for (const l of grupo) await sb.update("leads", l.id, { correoEnvioEnviado: true });
  } catch (e) { console.error("Error enviando correo de envío USA:", e); }
}

export async function enviarCorreoPagoConfirmadoUSA(env, sb, pedidoId) {
  if (!pedidoId) return;
  const RESEND_KEY = env.RESEND_KEY;
  if (!RESEND_KEY) return;
  try {
    const todosLeads = await sb.getAll("leads");
    const leadsPedido = todosLeads.filter(l => l.pedidoId === pedidoId && l.pais === "US");
    if (!leadsPedido.length) return;
    if (leadsPedido.some(l => l.correoPagoConfirmadoEnviado)) return; // ya se mandó

    const primero = leadsPedido[0];
    const correo = primero.correoCliente || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return;

    const en = primero.lang === "en";
    const nombreCliente = primero.nombreCliente || "";
    const filas = leadsPedido.map(l => {
      const nombre = l.nombre || l.codigo || "—";
      const precio = parseFloat(l.precio) || 0;
      return `<tr><td style="padding:6px 0;color:#111;">${nombre}</td><td style="padding:6px 0;color:#111;text-align:right;">$${precio.toFixed(2)}</td></tr>`;
    }).join("");
    const totalPedido = primero.totalPedidoUSD != null
      ? parseFloat(primero.totalPedidoUSD)
      : leadsPedido.reduce((s, l) => s + (parseFloat(l.precio) || 0), 0);

    const txt = en ? {
      subject: `✅ Payment received${primero.numeroPedidoUSA ? " — " + primero.numeroPedidoUSA : ""} — your VEREX Store order is on its way`,
      preheader: "Payment confirmed",
      hola: `Hi ${nombreCliente},`,
      msg: "We've received your payment! Your order is now being prepared and will ship via DHL — delivery takes 5–7 business days.",
      totalLbl: "Total paid",
      dudas: "Questions? Just reply to this email."
    } : {
      subject: `✅ Pago recibido${primero.numeroPedidoUSA ? " — " + primero.numeroPedidoUSA : ""} — tu pedido de VEREX Store va en camino`,
      preheader: "Pago confirmado",
      hola: `Hola ${nombreCliente},`,
      msg: "¡Recibimos tu pago! Tu pedido ya se está preparando y saldrá por DHL — la entrega toma de 5 a 7 días hábiles.",
      totalLbl: "Total pagado",
      dudas: "¿Dudas? Responde este correo."
    };

    await fetchResend("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: "VEREX Store <hola@notificaciones.verexstore.com>",
        reply_to: "hola@verexstore.com",
        to: [correo],
        subject: txt.subject,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #0a7d3d;border-radius:12px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#0a7d3d,#12a852);padding:24px;text-align:center;">
              <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#fff;">VEREX STORE</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#e8f7ee;">${txt.preheader}</p>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 16px;font-size:15px;color:#111;">${txt.hola}</p>
              <p style="margin:0 0 16px;font-size:14px;color:#444;">${txt.msg}</p>
              <table style="width:100%;border-collapse:collapse;font-size:13px;border-top:1px solid #eee;padding-top:8px;">
                ${filas}
                <tr><td style="padding:8px 0 2px;font-weight:700;color:#111;">${txt.totalLbl}</td><td style="padding:8px 0 2px;font-weight:700;color:#111;text-align:right;">$${totalPedido.toFixed(2)}</td></tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;color:#444;">${txt.dudas}</p>
            </div>
            <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #0a7d3d;text-align:center;font-size:12px;color:#888;">
              El mundo es mejor cuando brillas tú ✨
            </div>
          </div>`
      })
    });

    for (const l of leadsPedido) {
      await sb.update("leads", l.id, { correoPagoConfirmadoEnviado: true });
    }
  } catch (e) {
    console.error("Error enviando correo de pago confirmado:", e);
  }
}

export const RE_PEDIDO_USA = /^US[a-z0-9]{4,40}$/;

// ── NÚMERO CORTO DE PEDIDO USA (legible para el cliente y para el equipo): US-DDMM-NNN ───────────────
// El id largo (USmusun96u5ap8) sigue siendo la llave interna de los pagos; este es el que se ve en pantallas,
// correos y etiqueta. Día y mes en hora de El Salvador (UTC-6) y un contador del día. La unicidad la garantiza la
// base (insertIfAbsent): si dos pedidos piden el mismo número a la vez, uno gana y el otro toma el siguiente.
export function ddmmSV() { const d = new Date(Date.now() - 6 * 3600 * 1000); return String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0"); }

export async function numeroPedidoUSA(sb, pedidoId) {
  try {
    const previo = await sb.get("config", "usnum_ped_" + pedidoId);
    if (previo && previo.numero) return previo.numero;
    const ddmm = ddmmSV();
    const ctr = await sb.get("config", "usnum_ctr_" + ddmm);
    let n = ((ctr && ctr.n) || 0) + 1;
    for (let i = 0; i < 25; i++, n++) {
      const numero = `US-${ddmm}-${String(n).padStart(3, "0")}`;
      if (await sb.insertIfAbsent("config", "usnum_" + numero, { pedidoId, creado: Date.now() })) {
        await sb.set("config", "usnum_ctr_" + ddmm, { n });
        await sb.set("config", "usnum_ped_" + pedidoId, { numero });
        return numero;
      }
    }
  } catch (e) { console.error("numeroPedidoUSA:", e); }
  return "";     // sin número corto: las pantallas usan el id largo
}

export async function numeroGuardadoPedidoUSA(sb, pedidoId) {
  try { return (RE_PEDIDO_USA.test(pedidoId || "") && (await sb.get("config", "usnum_ped_" + pedidoId))?.numero) || ""; } catch (_) { return ""; }
}

// ── Total de un pedido USA calculado en el servidor ──
// Mismas reglas que us.verexstore.com (index.html → TRAMOS_ENVIO_US / MINIMO_COMPRA_USD / calcularDescuentoCupon).
// Si cambian los tramos o el mínimo en la tienda, cambiarlos también aquí (y en functions/_lib/knowledge.js).
export const TRAMOS_ENVIO_USA = [
  { min: 50, max: 74.99, costo: 19.99 },
  { min: 75, max: 99.99, costo: 14.99 },
  { min: 100, max: 149.99, costo: 9.99 },
  { min: 150, max: Infinity, costo: 0 },
];

export const MINIMO_COMPRA_USA = 50;

export const _r2 = n => Math.round(n * 100) / 100;

// Precios válidos de una línea del carrito USA según el inventario. Un set de anillos (set_config "a+b") se vende como
// pareja: unisex (código …UT7) = precio × piezas; dama + caballero = precio dama + precio de la talla de caballero
// (codigoCab, o cualquier talla C del diseño si no llegó); formato viejo = precio + precio_caballero.
// Trío con 2da pieza de dama "B" (codigoB): dama + pieza B + caballero. piezaDeSet = la tienda USA manda cada pieza
// del set como su propia línea (así cada una aparta su stock): entonces vale el precio de esa pieza sola.
export function preciosPermitidosUSA(row, hermanos, codigoCab, codigoB, piezaDeSet) {
  const p = parseFloat(row.precio) || 0;
  if (!row.set_config || piezaDeSet) return [_r2(p)];
  const [a, b] = String(row.set_config).split("+").map(n => parseInt(n) || 0);
  const out = new Set();
  const cod = String(row.codigo || row.id || "");
  if (/UT\d/i.test(cod)) out.add(_r2(p * ((a + b) || 1)));
  if (parseFloat(row.precio_caballero) > 0) out.add(_r2(p + parseFloat(row.precio_caballero)));
  const cabs = (hermanos || []).filter(h => /CT\d/i.test(String(h.codigo || h.id || "")) && h.estado !== "inactivo");
  const elegido = codigoCab ? cabs.find(h => String(h.codigo || h.id).toUpperCase() === String(codigoCab).toUpperCase()) : null;
  const piezaB = codigoB ? (hermanos || []).find(h => String(h.codigo || h.id).toUpperCase() === String(codigoB).toUpperCase() && _esPiezaB(h.codigo || h.id) && h.estado !== "inactivo") : null;
  const pB = piezaB ? (parseFloat(piezaB.precio) || 0) : 0;
  (elegido ? [elegido] : cabs).forEach(h => out.add(_r2(p + pB + (parseFloat(h.precio) || 0))));
  if (!out.size) out.add(_r2(p + pB));
  return [...out];
}

export function descuentoCuponUSA(cup, lineas, subtotal) {
  if (!cup) return 0;
  if (cup.tipo !== "monto_minimo" && (parseFloat(cup.montoMinimo) || 0) > 0 && subtotal < parseFloat(cup.montoMinimo)) return 0;
  let d = 0;
  switch (cup.tipo) {
    case "porcentaje_total": d = subtotal * (parseFloat(cup.descuento) || 0) / 100; break;
    case "porcentaje_categoria": {
      const cats = String(cup.categorias || "").split(",").map(x => x.trim()).filter(Boolean);
      d = lineas.filter(l => cats.includes(String(l.codigo || "").split("-")[0].toUpperCase())).reduce((s, l) => s + l.precio * l.qty, 0) * (parseFloat(cup.descuento) || 0) / 100; break;
    }
    case "segundo_mitad": {
      const unidades = lineas.flatMap(l => Array(l.qty).fill(l.precio));
      d = unidades.length < 2 ? 0 : Math.min(...unidades) * 0.5; break;
    }
    case "monto_minimo": d = subtotal < (parseFloat(cup.montoMinimo) || 0) ? 0 : (parseFloat(cup.descuentoFijo) || 0); break;
    case "envio_gratis": d = 0; break;
    case "descuento_fijo": d = parseFloat(cup.descuentoFijo) || 0; break;
    default: d = subtotal * (parseFloat(cup.descuento) || 0) / 100;
  }
  const tope = parseFloat(cup.descuentoMax) || 0;
  if (tope > 0) d = Math.min(d, tope);
  return _r2(Math.max(0, Math.min(d, subtotal)));
}

export function totalPedidoUSA(lineas, cup) {
  const subtotal = _r2(lineas.reduce((s, l) => s + l.precio * l.qty, 0));
  if (subtotal < MINIMO_COMPRA_USA) return { error: "minimo_compra" };
  const descuento = descuentoCuponUSA(cup, lineas, subtotal);
  let envio = (TRAMOS_ENVIO_USA.find(t => subtotal >= t.min && subtotal <= t.max) || { costo: 0 }).costo;   // tramo con el subtotal antes del cupón
  const minOk = !cup || cup.tipo === "monto_minimo" || !((parseFloat(cup.montoMinimo) || 0) > subtotal);
  if (cup && cup.tipo === "envio_gratis" && minOk) envio = 0;
  return { subtotal, descuento, envio, total: _r2(subtotal - descuento + envio) };
}
