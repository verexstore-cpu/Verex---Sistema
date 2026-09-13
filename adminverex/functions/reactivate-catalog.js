import { esAdminValido, noAutorizado } from "./_auth.js";

export async function onRequest(context) {
    const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
    const headers = { "Content-Type": "application/json", ...cors };
    if (context.request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (context.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await context.request.json();
        if (!(await esAdminValido(body?._pass))) return noAutorizado(cors);
        const id = String(body?.id || "").trim();
        const dias = Math.min(Math.max(parseInt(body?.dias) || 15, 1), 30);
        if (!id) return new Response(JSON.stringify({ error: "Falta el id" }), { status: 400, headers });

        // Leer el registro histórico permanente
        const rawHist = await context.env.CATALOGS.get("__hist__" + id);
        if (!rawHist) return new Response(JSON.stringify({ error: "No existe registro histórico para este link" }), { status: 404, headers });

        const hist = JSON.parse(rawHist);
        const expiresAt = Date.now() + dias * 86400000;

        // Restaurar el catálogo en KV con nuevo TTL
        const data = { ...hist.data, expiry: expiresAt, dias };
        await context.env.CATALOGS.put(id, JSON.stringify(data), {
            expirationTtl: 60 * 60 * 24 * dias,
        });

        // Actualizar el registro histórico con la nueva expiración
        const updatedHist = { ...hist, expiresAt, dias, activo: true, data };
        await context.env.CATALOGS.put("__hist__" + id, JSON.stringify(updatedHist));

        return new Response(JSON.stringify({ ok: true, expiresAt }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
}
