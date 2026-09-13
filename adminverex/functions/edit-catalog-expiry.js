import { esAdminValido, noAutorizado } from "./_auth.js";

export async function onRequest(context) {
    const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
    if (context.request.method === "OPTIONS") {
        return new Response(null, { headers: cors });
    }
    if (context.request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const headers = { "Content-Type": "application/json", ...cors };

    try {
        const body = await context.request.json();
        if (!(await esAdminValido(body?._pass))) return noAutorizado(cors);
        const id = String(body?.id || "").trim();
        if (!id) {
            return new Response(JSON.stringify({ error: "Falta el id del catálogo" }), { status: 400, headers });
        }
        const dias = Math.min(Math.max(parseInt(body?.dias) || 1, 1), 30);

        const raw = await context.env.CATALOGS.get(id);
        if (!raw) {
            return new Response(JSON.stringify({ error: "Ese link no existe o ya expiró" }), { status: 404, headers });
        }

        // Actualiza tanto el campo interno "expiry" (lo que revisa el propio
        // catalogo.html al abrirse) como el TTL real de la llave en KV (lo
        // que hace que Cloudflare borre el registro solo) — si solo se
        // tocara uno de los dos, podrían quedar desincronizados.
        const data = JSON.parse(raw);
        data.expiry = Date.now() + dias * 86400000;
        data.dias = dias;

        await context.env.CATALOGS.put(id, JSON.stringify(data), {
            expirationTtl: 60 * 60 * 24 * dias,
        });

        return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
