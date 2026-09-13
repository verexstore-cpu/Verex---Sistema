import { esAdminValido, noAutorizado } from "./_auth.js";

export async function onRequest(context) {
    const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
    if (context.request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (context.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const headers = { "Content-Type": "application/json", ...cors };

    try {
        const body = await context.request.json().catch(() => ({}));
        if (!(await esAdminValido(body?._pass))) return noAutorizado(cors);

        // Listar todos los __hist__ entries — es el registro permanente (sin
        // TTL) que save-catalog.js escribe por cada link generado, así que
        // es la fuente autoritativa: no depende del localStorage de ningún
        // navegador ni de en qué PC se generó el link.
        let cursor = undefined;
        const hists = [];
        do {
            const listed = await context.env.CATALOGS.list({ prefix: "__hist__", cursor, limit: 200 });
            const raws = await Promise.all(listed.keys.map(k => context.env.CATALOGS.get(k.name)));
            raws.forEach(raw => { if (raw) hists.push(JSON.parse(raw)); });
            cursor = listed.list_complete ? undefined : listed.cursor;
        } while (cursor);

        const now = Date.now();

        // Batch de vistas — un solo round de gets en vez de uno por catálogo
        const viewsRaws = await Promise.all(hists.map(h => context.env.CATALOGS.get("__views__" + h.id)));

        const catalogos = hists.map((h, i) => {
            const views = viewsRaws[i] ? JSON.parse(viewsRaws[i]) : null;
            return {
                id: h.id,
                url: "https://admin-tienda.pages.dev/c/" + h.id,
                tipo: h.tipo || (h.afiliadoCodigo ? "afiliado" : "cliente"),
                nombre: h.nombre || "",
                afiliadoCodigo: h.afiliadoCodigo || "",
                createdAt: h.createdAt || null,
                expiresAt: h.expiresAt || null,
                activo: h.expiresAt ? h.expiresAt > now : false,
                prods: h.data?.prods?.length || 0,
                vistas: views?.count || 0,
                ultimaVista: views?.last || null,
                primeraVista: views?.first || null,
                wa: h.data?.wa || "",
                receta: h.data?.receta || null,
                nota: h.data?.nota_interna || "",
                banner: h.data?.banner || null,
                descPct: h.data?.descPct || 0,
                promoCarrito: h.data?.promoCarrito || (h.data?.promo2x50 ? { tipo: "2x50" } : null),
                envioGratisDesde: h.data?.envioGratisDesde || 0,
                regaloSorpresa: h.data?.regaloSorpresa || null,
            };
        });

        catalogos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return new Response(JSON.stringify({ ok: true, total: catalogos.length, catalogos }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
}
