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

    const headers = { "Content-Type": "application/json", ...cors };

    try {
        const { ids, _pass } = await context.request.json();
        if (!(await esAdminValido(_pass))) return noAutorizado(cors);
        if (!Array.isArray(ids) || !ids.length) {
            return new Response(JSON.stringify({ views: {} }), { headers });
        }

        const results = await Promise.all(
            ids.map(async id => {
                const raw = await context.env.CATALOGS.get("__views__" + id);
                return [id, raw ? JSON.parse(raw) : null];
            })
        );

        const views = Object.fromEntries(results.filter(([, v]) => v !== null));
        return new Response(JSON.stringify({ views }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
