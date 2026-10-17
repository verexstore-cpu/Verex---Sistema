// Avisos: correo (Resend) y WhatsApp al admin
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json"
};

export const ADMIN_WA = "50371250725";

// ── WOMPI (pago con tarjeta, catálogo USA) ────────────────────────

// Correo al cliente cuando su pago se confirma de verdad — automático desde
// el webhook de Wompi, o cuando el admin marca "pagado" a mano (PayPal).
// Antes no existía: el cliente solo veía el correo inicial de "completá tu
// pago", nunca un aviso de que el pago sí llegó.
//
// Se manda UNO por pedido (agrupado por pedidoId), no uno por producto —
// un pedido de 3 artículos no debe generar 3 correos. Se guarda una bandera
// en los leads del grupo para no reenviarlo si esto se llama de nuevo
// (reintento del webhook de Wompi, o el admin marca cada artículo por
// separado en vez de todo el pedido junto).
// Envío por Resend. Antes ninguna llamada revisaba la respuesta: si Resend rechazaba el correo
// (clave inválida, dominio sin verificar, límite diario) no quedaba rastro y parecía que "no pasó nada".
// Ahora cualquier rechazo se registra en los logs del Worker con el motivo exacto.
export let _sbCorreo = null;

            // conexión a la base, para guardar el estado de los correos
export let _correoOkConocido = null;

    // último estado visto por esta instancia (evita escribir en cada correo)
export async function registrarEstadoCorreo(ok, info) {
  if (_correoOkConocido === ok && ok === true) return;
  _correoOkConocido = ok;
  if (!_sbCorreo) return;
  try {
    await _sbCorreo.set("config", "correo_estado", ok
      ? { ok: true, fecha: new Date().toISOString() }
      : { ok: false, fecha: new Date().toISOString(), status: info?.status || null, detalle: String(info?.detalle || info?.motivo || "").slice(0, 300) });
  } catch (e) { console.error("No se pudo guardar el estado de los correos:", e); }
}

export async function fetchResend(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let detalle = "";
    try { detalle = (await res.clone().text()).slice(0, 300); } catch (_) {}
    let para = "";
    try { para = JSON.parse(opts.body).to; } catch (_) {}
    console.error(`Resend rechazó el correo (HTTP ${res.status}) para ${JSON.stringify(para)}: ${detalle}`);
    await registrarEstadoCorreo(false, { status: res.status, detalle });
  } else {
    await registrarEstadoCorreo(true);
  }
  return res;
}

// Diagnóstico de correos (solo admin): manda un correo de prueba y devuelve el motivo exacto si falla.
export async function probarCorreo(env, para) {
  const tieneClave = !!env.RESEND_KEY;
  if (!tieneClave) {
    await registrarEstadoCorreo(false, { motivo: "falta_clave", detalle: "El Worker no tiene el secreto RESEND_KEY configurado en Cloudflare." });
    return { ok: false, tieneClave, motivo: "falta_clave", detalle: "El Worker no tiene el secreto RESEND_KEY configurado en Cloudflare." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_KEY}` },
      body: JSON.stringify({
        from: "VEREX Store <hola@notificaciones.verexstore.com>",
        reply_to: "hola@verexstore.com",
        to: [para],
        subject: "✅ Prueba de correo — VEREX",
        html: "<p>Este es un correo de prueba del sistema VEREX. Si lo ves, el envío de correos funciona.</p>"
      })
    });
    const txt = (await res.text()).slice(0, 400);
    await registrarEstadoCorreo(res.ok, { status: res.status, detalle: txt });
    return { ok: res.ok, tieneClave, status: res.status, detalle: txt };
  } catch (e) {
    await registrarEstadoCorreo(false, { motivo: "red", detalle: String(e && e.message || e) });
    return { ok: false, tieneClave, motivo: "red", detalle: String(e && e.message || e) };
  }
}

// Correo al que llega el código de autorización (buzón personal del dueño, NO el compartido de pedidos).
// Se puede cambiar sin tocar el código creando el secreto CORREO_CODIGOS en Cloudflare.
export const CORREO_CODIGOS_DEFECTO = "eramayanavarro@gmail.com";

export function correoCodigos(env) {
  const c = String(env.CORREO_CODIGOS || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : CORREO_CODIGOS_DEFECTO;
}

export function correoOculto(c) { const [u, d] = String(c).split("@"); return (u || "").slice(0, 2) + "•••@" + (d || ""); }

export async function enviarWhatsAppAdmin(env, texto) {
  const apikey = env.CALLMEBOT_KEY || "";
  if (!apikey) return { ok: false, motivo: "sin_whatsapp" };
  try {
    const res = await fetch(`https://api.callmebot.com/whatsapp.php?phone=${ADMIN_WA}&text=${encodeURIComponent(texto)}&apikey=${apikey}`);
    return res.ok ? { ok: true } : { ok: false, motivo: "whatsapp_fallo", status: res.status };
  } catch (e) { return { ok: false, motivo: "whatsapp_fallo" }; }
}

// La conexión a la base la fija cada petición / tarea programada (worker-firebase.js, cron.js).
export function fijarSbCorreo(sb) { _sbCorreo = sb; }
