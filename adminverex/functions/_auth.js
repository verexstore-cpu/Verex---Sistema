// Verifica la sesión de admin contra el worker (misma fuente de verdad que
// usa el panel) en vez de mantener un segundo secreto separado acá.
//
// Sin esto, las Functions de catálogo/afiliado (save-catalog, clone-catalog,
// deactivate-catalog, reactivate-catalog, edit-catalog-expiry,
// edit-catalog-products, list-catalogs, catalog-views, affiliate-stats,
// banner-afiliado, backfill-affiliate-index) eran rutas HTTP públicas:
// cualquiera con la URL podía leer notas internas y teléfonos de clientes,
// desactivar o editar cualquier catálogo ajeno, o inyectar productos, sin
// ninguna credencial.
//
// Lo que llega en _pass es el pase de sesión del panel (8 h, contraseña + código).
// Se valida con VERIFICAR_SESION — mismo criterio que las acciones de admin del
// Worker. VERIFICAR_PASS no sirve aquí: aceptaría la contraseña sola, sin el código.
export async function esAdminValido(pass, context) {
  if (!pass) return false;
  try {
    const llamar = async (accion) => {
      const r = await fetch("https://verex-api.verexstore.workers.dev/", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecerasInternas(context) },
        body: JSON.stringify({ accion, _pass: pass }),
      });
      return r.json();
    };
    let data = await llamar("VERIFICAR_SESION");
    // Worker anterior a las sesiones (solo durante el minuto que tarda en publicarse).
    if (data?.ok !== true && /no reconocida/i.test(String(data?.error || ""))) data = await llamar("VERIFICAR_PASS");
    return data?.ok === true;
  } catch (e) {
    return false;
  }
}

// Valida a un vendedor con su token de Inventario Sellers (+ PIN si lo tiene)
// usando el mismo VERIFICAR_TOKEN del Worker con el que entra a su página.
// Devuelve el registro del vendedor, o null si no es válido / su corte venció.
export async function vendedorValido(vendedor, token, pin, context) {
  if (!vendedor || !token) return null;
  try {
    const r = await fetch("https://verex-api.verexstore.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecerasInternas(context) },
      body: JSON.stringify({ accion: "VERIFICAR_TOKEN", vendedor, token, pin: pin || "" }),
    });
    const data = await r.json();
    return data?.ok === true && data.vendedor ? data.vendedor : null;
  } catch (e) {
    return null;
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
