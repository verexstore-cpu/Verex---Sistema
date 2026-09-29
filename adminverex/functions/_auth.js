// Verifica la contraseña de admin contra el worker (misma fuente de verdad
// que usa el login del panel — Supabase config/settings.passHash o
// SECRET_PASS) en vez de mantener un segundo secreto separado acá.
//
// Sin esto, las Functions de catálogo/afiliado (save-catalog, clone-catalog,
// deactivate-catalog, reactivate-catalog, edit-catalog-expiry,
// edit-catalog-products, list-catalogs, catalog-views, affiliate-stats,
// banner-afiliado, backfill-affiliate-index) eran rutas HTTP públicas:
// cualquiera con la URL podía leer notas internas y teléfonos de clientes,
// desactivar o editar cualquier catálogo ajeno, o inyectar productos, sin
// ninguna credencial.
export async function esAdminValido(pass, context) {
  if (!pass) return false;
  try {
    const r = await fetch("https://verex-api.verexstore.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecerasInternas(context) },
      body: JSON.stringify({ accion: "VERIFICAR_PASS", _pass: pass }),
    });
    const data = await r.json();
    return data?.ok === true;
  } catch (e) {
    return false;
  }
}

// El Worker limita los intentos fallidos por IP. Desde una Function, la IP que ve el Worker es la de
// Cloudflare (compartida por todos), así que reenviamos la IP real del cliente; el Worker solo la
// acepta si además llega INTERNAL_SECRET (definido igual en el Worker y en este proyecto de Pages).
// Sin la variable configurada no se envía nada y todo sigue funcionando como antes.
function cabecerasInternas(context) {
  const h = {};
  try {
    const ip = context?.request?.headers?.get("CF-Connecting-IP");
    const secreto = context?.env?.INTERNAL_SECRET;
    if (ip && secreto) { h["X-Verex-Client-IP"] = ip; h["X-Verex-Internal"] = secreto; }
  } catch (_) { /* sin cabeceras internas */ }
  return h;
}

export function noAutorizado(cors) {
  return new Response(JSON.stringify({ ok: false, error: "No autorizado" }), {
    status: 403,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
