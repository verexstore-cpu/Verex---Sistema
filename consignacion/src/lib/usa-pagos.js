// Pagos USA: PayPal, Wompi, cobro y código para autorizar reembolsos
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { correoCodigos, correoOculto, enviarWhatsAppAdmin, fetchResend } from "./avisos.js";
import { cuponNoUsable, idClienteCupon } from "./cupones.js";
import { json } from "./http.js";
import { RE_PEDIDO_USA, avisarAdminUSA, enviarCorreoPagoConfirmadoUSA, totalPedidoUSA } from "./usa-pedidos.js";

// ── CÓDIGO DE UN SOLO USO para autorizar reembolsos ────────────────────────
// Un reembolso devuelve dinero y no se puede deshacer: además de la sesión de admin, pide un código de 6 dígitos
// que llega por correo (y por WhatsApp si CALLMEBOT_KEY está configurada). Vale 10 min, se usa una sola vez,
// está atado a UN pedido y se bloquea tras 5 intentos fallidos. Solo se guarda su huella (hash), nunca el código.
export const OTP_REEMB_VIGENCIA_MS = 10 * 60 * 1000;

export const OTP_REEMB_MAX_INTENTOS = 5;

export async function huellaCodigoReembolso(env, pedidoId, codigo) {
  const sal = String(env.SECRET_PASS || env.SUPABASE_SERVICE_KEY || "");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reembolso|${pedidoId}|${codigo}|${sal}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function codigoAleatorio6() {
  const n = new Uint32Array(1); crypto.getRandomValues(n);
  return String(n[0] % 1000000).padStart(6, "0");
}

// Manda el código por correo (canal principal) y también por WhatsApp si CALLMEBOT_KEY está configurada.
// Basta con que UNO de los canales funcione; si ninguno, el reembolso no se puede autorizar (falla cerrado).
export async function enviarCodigoReembolso(env, pid, total, codigo) {
  const canales = [];
  const monto = total != null ? ` ($${parseFloat(total).toFixed(2)})` : "";
  if (env.RESEND_KEY) {
    try {
      const res = await fetchResend("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_KEY}` },
        body: JSON.stringify({
          from: "VEREX Store <hola@notificaciones.verexstore.com>",
          to: [correoCodigos(env)],
          subject: `🔐 Código para autorizar el reembolso — pedido ${pid}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:2px solid #C9A84C;border-radius:12px;">
            <h2 style="margin:0 0 12px;color:#111;">Autorizar reembolso</h2>
            <p style="font-size:14px;color:#444;">Pedido <b>${pid}</b>${monto}. Escribe este código en el panel de Logística USA:</p>
            <p style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;margin:20px 0;color:#111;">${codigo}</p>
            <p style="font-size:12px;color:#888;">Vale 10 minutos y se usa una sola vez. Si tú no pediste este reembolso, ignora este correo y avisa: alguien con acceso al panel lo intentó.</p></div>`
        })
      });
      if (res.ok) canales.push("correo");
    } catch (e) { console.error("Código de reembolso por correo falló:", e); }
  }
  if (env.CALLMEBOT_KEY) {
    const wa = await enviarWhatsAppAdmin(env, `VEREX — código para autorizar el REEMBOLSO del pedido ${pid}${monto}: ${codigo}\nVale 10 minutos y se usa una sola vez. Si no lo pediste, ignóralo.`);
    if (wa.ok) canales.push("whatsapp");
  }
  if (!canales.length) return { ok: false, motivo: (env.RESEND_KEY || env.CALLMEBOT_KEY) ? "envio_fallo" : "sin_canal" };
  return { ok: true, canales, destino: canales.includes("correo") ? correoOculto(correoCodigos(env)) : "" };
}

// OAuth 2.0 Client Credentials — el token dura 1h, pero como cada request
// del worker es una invocación aparte no vale la pena cachearlo entre
// peticiones (bajo volumen de pedidos); se pide uno nuevo cada vez.
export async function wompiToken(env) {
  const res = await fetch("https://id.wompi.sv/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      audience: "wompi_api",
      client_id: env.WOMPI_CLIENT_ID,
      client_secret: env.WOMPI_CLIENT_SECRET
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("No se pudo autenticar con Wompi");
  return data.access_token;
}

// El webhook llega apenas Wompi resuelve la transacción (aprobada o no).
// Como no hay firma documentada para validarlo, la URL secreta (ver arriba)
// es la única autenticación — así que acá sí se confía en el body.
// Marca como pagado TODO el pedido USA (un lead por producto), ya sea por tarjeta (webhook de Wompi) o por
// PayPal (captura / webhook). Idempotente: los leads ya pagados se saltan. Si el pago llega con la reserva vencida
// reactiva el pedido cuando todavía hay stock; si ya no hay, queda "pagado sin stock" y se avisa al equipo.
export async function confirmarPagoPedidoUSA(env, sb, pedidoId, { metodo, idTransaccion, extra }) {
  const etiqueta = metodo === "paypal" ? "PayPal" : "tarjeta (Wompi)";
  const leadsPedido = (await sb.query("leads", "pedidoId", "eq", pedidoId)).filter(l => l.pais === "US");
  const avisosSinStock = [];
  let nuevos = 0;
  for (const lead of leadsPedido) {
    if (lead.pagadoUSA) continue; // ya procesado — evita reservar dos veces
    nuevos++;
    const patch = { pagadoUSA: true, metodoPagoUSA: metodo, reservaExpiraEn: null, ...(extra || {}) };
    if (metodo === "wompi") patch.wompiIdTransaccion = idTransaccion;
    let sinStock = null;
    // La reserva normalmente ya se hizo en REGISTRAR_LEAD (antes de pagar) — acá solo se confirma. Si por algo
    // el lead nunca llegó a reservar, o la reserva ya se liberó, se reserva recién ahora como respaldo.
    if (!lead.reservaDescTienda && !lead.reservaDescBodega) {
      try {
        const res = await sb.reservar(lead.codigo, lead.qty || 1);
        if (res.ok) {
          patch.reservaDescTienda = res.desc_tienda || 0;
          patch.reservaDescBodega = res.desc_bodega || 0;
        } else {
          sinStock = "sin stock";
          console.error("Pago " + etiqueta + ": sin stock para " + lead.codigo + " (pedido " + pedidoId + ")");
        }
      } catch (eRes) {
        sinStock = "error al reservar";
        console.error("Pago " + etiqueta + ": error reservando " + lead.codigo, eRes);
      }
    }
    if (lead.estado === "cancelado" && !sinStock) {
      patch.estado = "interesado";
      patch.historial = [...(lead.historial || []), { estado: "interesado", fecha: new Date().toISOString(), motivo: "Pago con " + etiqueta + " confirmado tras vencer la reserva" }];
    }
    if (sinStock) { patch.pagadoSinStock = true; avisosSinStock.push(`${lead.nombre || lead.codigo} (${lead.codigo})`); }
    await sb.update("leads", lead.id, patch);
  }
  if (avisosSinStock.length) {
    await avisarAdminUSA(env, `⚠️ Pedido USA pagado SIN STOCK — ${pedidoId}`,
      `<p>El cliente pagó con ${etiqueta} el pedido <b>${pedidoId}</b>, pero no se pudo reservar stock de: <b>${avisosSinStock.join(", ")}</b>.</p>
       <p>Revisa el panel de Logística USA: hay que conseguir la pieza o reembolsar el pago${metodo === "paypal" ? " (botón «Reembolsar» del panel)" : " en Wompi"}.</p>`);
  }
  if (nuevos) await enviarCorreoPagoConfirmadoUSA(env, sb, pedidoId);
  return { leads: leadsPedido.length, nuevos };
}

export async function manejarWebhookWompi(request, env, sb) {
  try {
    const payload = await request.json();
    const idTransaccion = payload.IdTransaccion;
    const pedidoId = payload.EnlacePago?.IdentificadorEnlaceComercio;
    if (!idTransaccion || !pedidoId) return json({ ok: true });
    if (payload.ResultadoTransaccion !== "ExitosaAprobada") return json({ ok: true });
    await confirmarPagoPedidoUSA(env, sb, pedidoId, { metodo: "wompi", idTransaccion });
    return json({ ok: true });
  } catch(e) {
    console.error("Webhook Wompi error:", e);
    // Siempre 200 — un error nuestro no debe hacer que Wompi reintente
    // indefinidamente el mismo webhook.
    return json({ ok: true });
  }
}

// ── PAYPAL (checkout oficial, catálogo USA) ───────────────────────
// Flujo: la página pide CREAR_ORDEN_PAYPAL → el cliente aprueba el pago en PayPal → vuelve a la página, que pide
// CAPTURAR_ORDEN_PAYPAL (cobra de verdad) → el pedido queda pagado y sale el correo. El webhook de PayPal es el
// respaldo por si el cliente cierra la pestaña después de aprobar. Para pruebas: PAYPAL_ENV distinto de "live" = Sandbox.
export const _ppTokenCache = new Map();

export function paypalBase(env) { return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"; }

export function paypalConfigurado(env) { return !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET); }

export async function paypalToken(env) {
  const base = paypalBase(env), c = _ppTokenCache.get(base);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const res = await fetch(base + "/v1/oauth2/token", {
    method: "POST",
    headers: { "Authorization": "Basic " + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error("PayPal token: " + res.status + " " + String(data.error_description || data.error || "").slice(0, 120));
  _ppTokenCache.set(base, { token: data.access_token, exp: Date.now() + (parseInt(data.expires_in) || 300) * 1000 });
  return data.access_token;
}

export async function paypalApi(env, method, path, body, requestId) {
  const token = await paypalToken(env);
  const headers = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(paypalBase(env) + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const RE_PAYPAL_ORDER = /^[A-Z0-9]{8,30}$/;

export function paypalCapturaDe(order) {
  const caps = order?.purchase_units?.[0]?.payments?.captures;
  return Array.isArray(caps) ? (caps.find(c => c.status === "COMPLETED") || null) : null;
}

// ¿El monto cobrado coincide con el total que quedó registrado en el pedido? (evita marcar pagado un pago por menos)
export function montoCoincide(leads, captura) {
  const esperado = leads.find(l => l.totalVerificadoUSD != null)?.totalVerificadoUSD ?? leads.find(l => l.totalPedidoUSD != null)?.totalPedidoUSD;
  if (esperado == null) return true;   // pedidos viejos sin total guardado
  const cobrado = parseFloat(captura?.amount?.value);
  return captura?.amount?.currency_code === "USD" && Math.abs(cobrado - parseFloat(esperado)) < 0.011;
}

export async function manejarWebhookPayPal(request, env, sb) {
  try {
    const raw = await request.text();
    let evento; try { evento = JSON.parse(raw); } catch (_) { return json({ ok: false, error: "json" }, 400); }
    if (!paypalConfigurado(env) || !env.PAYPAL_WEBHOOK_ID) return json({ ok: false, error: "no_configurado" }, 400);
    const h = n => request.headers.get(n) || "";
    const v = await paypalApi(env, "POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"),
      webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: evento
    });
    if (!v.ok || v.data?.verification_status !== "SUCCESS") {
      console.error("Webhook PayPal: firma no válida", v.status, JSON.stringify(v.data).slice(0, 200));
      return json({ ok: false, error: "firma" }, 400);
    }
    const r = evento.resource || {};
    if (evento.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = r.supplementary_data?.related_ids?.order_id || "";
      let pedidoId = RE_PEDIDO_USA.test(r.custom_id || "") ? r.custom_id : "";
      if (!pedidoId && RE_PAYPAL_ORDER.test(orderId)) {
        const porOrden = (await sb.query("leads", "paypalOrderId", "eq", orderId))[0];
        pedidoId = porOrden?.pedidoId || "";
      }
      if (pedidoId) {
        const leads = (await sb.query("leads", "pedidoId", "eq", pedidoId)).filter(l => l.pais === "US");
        if (leads.length && montoCoincide(leads, r)) {
          await confirmarPagoPedidoUSA(env, sb, pedidoId, { metodo: "paypal", idTransaccion: r.id, extra: { paypalCaptureId: r.id, paypalOrderId: orderId || leads[0].paypalOrderId || "" } });
        } else if (leads.length) {
          await avisarAdminUSA(env, `⚠️ PayPal: el monto cobrado no coincide — ${pedidoId}`, `<p>PayPal cobró <b>${r.amount?.value} ${r.amount?.currency_code}</b> en el pedido <b>${pedidoId}</b>, pero el total registrado es <b>${leads.find(l => l.totalPedidoUSD != null)?.totalPedidoUSD}</b>. No se marcó como pagado: revísalo en PayPal.</p>`);
        }
      }
    } else if (evento.event_type === "PAYMENT.CAPTURE.REFUNDED" || evento.event_type === "PAYMENT.CAPTURE.REVERSED") {
      // Reembolso o contracargo hechos desde el panel de PayPal: se marca en el pedido para que se vea en Logística USA.
      const cap = (await sb.query("leads", "paypalCaptureId", "eq", r.id || ""));
      for (const l of cap) await sb.update("leads", l.id, { reembolsadoUSA: true });
    }
    return json({ ok: true });
  } catch (e) {
    console.error("Webhook PayPal error:", e);
    return json({ ok: false, error: "interno" }, 500);   // 5xx: PayPal reintenta el aviso
  }
}

// Antes de crear el cobro: lee los productos del pedido (ya verificados en REGISTRAR_LEAD), valida el cupón y calcula
// el total. Si el navegador mostró otro total, no se cobra (precios cambiados o carrito alterado).
export async function prepararCobroUSA(sb, pid, d) {
  const leads = (await sb.query("leads", "pedidoId", "eq", pid)).filter(l => l.pais === "US" && l.estado !== "cancelado");
  if (!leads.length) return { ok: false, error: "pedido_sin_productos" };
  if (leads.length > 30) return { ok: false, error: "pedido_invalido" };
  // Reintento del mismo pedido (otra pestaña, error de red): se reusa el total ya verificado y el cupón no se gasta dos veces.
  const yaCerrado = leads.find(l => l.totalVerificadoUSD != null);
  if (yaCerrado) return { ok: true, leads, total: yaCerrado.totalVerificadoUSD, reintento: true };
  if (leads.some(l => !l.precioVerificado)) return { ok: false, error: "monto_no_coincide" };   // algún precio no coincide con el inventario
  let cup = null;
  const codCup = String(d.cupon || "").trim().toUpperCase();
  if (codCup) {
    cup = await sb.get("cupones", codCup);
    const err = cuponNoUsable(cup, leads[0].correoCliente, "us");
    if (err) return { ok: false, error: "cupon_invalido", motivo: err.motivo };
  }
  const lineas = leads.map(l => ({ codigo: l.codigo, precio: parseFloat(l.precio) || 0, qty: parseInt(l.qty) || 1 }));
  const calc = totalPedidoUSA(lineas, cup);
  if (calc.error) return { ok: false, error: calc.error };
  if (Math.abs(calc.total - (parseFloat(d.monto) || 0)) > 0.011) return { ok: false, error: "monto_no_coincide", total: calc.total };
  return { ok: true, leads, cup, ...calc };
}

// Después de crear el cobro: gasta el cupón (una sola vez) y deja en cada producto del pedido el total verificado,
// el link/orden de pago y la marca de pedido cerrado.
export async function cerrarCobroUSA(sb, cobro, extra) {
  if (!cobro.reintento && cobro.cup) {
    const cup = cobro.cup, idCli = idClienteCupon(cobro.leads[0].correoCliente);
    const usos = (parseInt(cup.usosActuales) || 0) + 1, limite = parseInt(cup.limiteUsos) || 0;
    const patchCup = { usosActuales: usos, activo: limite > 0 ? usos < limite : true };
    if (cup.unoPorCliente && idCli) patchCup.usadoPor = [...(Array.isArray(cup.usadoPor) ? cup.usadoPor : []), idCli].slice(-5000);
    await sb.update("cupones", cup.codigo, patchCup);
  }
  const patch = { ...extra, pagoCreadoEn: new Date().toISOString() };
  if (!cobro.reintento) Object.assign(patch, {
    totalVerificadoUSD: cobro.total, totalPedidoUSD: cobro.total, envioUSD: cobro.envio, descuentoUSD: cobro.descuento,
    cuponUSA: cobro.cup ? cobro.cup.codigo : ""
  });
  await Promise.all(cobro.leads.map(l => sb.update("leads", l.id, patch)));
}
