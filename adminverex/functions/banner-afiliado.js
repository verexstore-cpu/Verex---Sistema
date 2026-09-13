// Banner global para catálogos de afiliado — a diferencia del banner de
// cliente (que se define cada vez que se genera un link, guardado dentro del
// propio registro KV del catálogo), este banner es UNO SOLO compartido por
// TODOS los catálogos de afiliado, editable desde el admin, y se inyecta en
// tiempo real en c/[id].js — así no hay que regenerar ningún link de afiliado
// ya compartido para que la promo aparezca o se quite.
import { esAdminValido, noAutorizado } from "./_auth.js";

const KEY = "__banner_afiliado_global__";

export async function onRequest(context) {
    const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
    if (context.request.method === "OPTIONS") {
        return new Response(null, { headers: cors });
    }

    const headers = { "Content-Type": "application/json", ...cors };

    // GET quedó reemplazado por POST con _pass: el banner público que ven los
    // clientes lo lee c/[id].js directo de KV (no llama a este endpoint), así
    // que este archivo solo lo usa el panel de admin para editar/previsualizar.
    if (context.request.method === "POST") {
        try {
            const body = await context.request.json();
            if (!(await esAdminValido(body?._pass))) return noAutorizado(cors);

            if (body?._leer) {
                const raw = await context.env.CATALOGS.get(KEY);
                return new Response(raw || JSON.stringify({ txt: "", sub: "", color: "#7c3aed", activo: false }), { headers });
            }

            const data = {
                txt: String(body?.txt || "").trim(),
                sub: String(body?.sub || "").trim(),
                color: String(body?.color || "#7c3aed"),
                activo: !!body?.activo,
            };
            // Sin expirationTtl — el banner global vive hasta que lo edite el admin.
            await context.env.CATALOGS.put(KEY, JSON.stringify(data));
            return new Response(JSON.stringify({ ok: true }), { headers });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
        }
    }

    return new Response("Method Not Allowed", { status: 405 });
}
