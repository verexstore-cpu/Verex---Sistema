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
        if (!(await esAdminValido(body?._pass, context))) return noAutorizado(cors);
        const id = String(body?.id || "").trim();
        if (!id) {
            return new Response(JSON.stringify({ error: "Falta el id del catálogo" }), { status: 400, headers });
        }

        await context.env.CATALOGS.delete(id);

        // Si se pide eliminar del historial también, borrar el registro permanente
        if (body?.eliminarHistorial) {
            await context.env.CATALOGS.delete("__hist__" + id);
        } else {
            // El tab Links calcula "activo" a partir de __hist__.expiresAt
            // (list-catalogs.js), NO de si el link en sí sigue existiendo —
            // sin esto, el link quedaba roto pero la lista lo seguía
            // mostrando como ACTIVO hasta que la fecha real de vencimiento
            // pasara sola.
            const rawHist = await context.env.CATALOGS.get("__hist__" + id);
            if (rawHist) {
                const hist = JSON.parse(rawHist);
                hist.expiresAt = Date.now() - 1000;
                await context.env.CATALOGS.put("__hist__" + id, JSON.stringify(hist));
            }
        }

        return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
