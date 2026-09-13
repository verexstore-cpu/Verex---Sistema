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
export async function esAdminValido(pass) {
  if (!pass) return false;
  try {
    const r = await fetch("https://verex-api.verexstore.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "VERIFICAR_PASS", _pass: pass }),
    });
    const data = await r.json();
    return data?.ok === true;
  } catch (e) {
    return false;
  }
}

export function noAutorizado(cors) {
  return new Response(JSON.stringify({ ok: false, error: "No autorizado" }), {
    status: 403,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
