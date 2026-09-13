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
        const { afiliadoCodigo, _pass } = await context.request.json();
        if (!(await esAdminValido(_pass))) return noAutorizado(cors);
        if (!afiliadoCodigo) return new Response(JSON.stringify({ error: "afiliadoCodigo requerido" }), { status: 400, headers });

        const rawIdx = await context.env.CATALOGS.get("__affiliate__" + afiliadoCodigo);
        if (!rawIdx) {
            return new Response(JSON.stringify({
                totalCatalogos: 0, totalVistas: 0, ultimaVista: null,
                catalogoActivo: null, catalogos: []
            }), { headers });
        }

        const { ids } = JSON.parse(rawIdx);
        const now = Date.now();

        const [histRaws, viewsRaws] = await Promise.all([
            Promise.all(ids.map(id => context.env.CATALOGS.get("__hist__" + id))),
            Promise.all(ids.map(id => context.env.CATALOGS.get("__views__" + id))),
        ]);

        let totalVistas = 0, ultimaVista = null, catalogoActivo = null;
        const catalogos = [];

        ids.forEach((id, i) => {
            const hist = histRaws[i] ? JSON.parse(histRaws[i]) : null;
            const views = viewsRaws[i] ? JSON.parse(viewsRaws[i]) : null;

            if (views) {
                totalVistas += views.count || 0;
                if (!ultimaVista || views.last > ultimaVista) ultimaVista = views.last;
            }

            const activo = hist ? hist.expiresAt > now : false;
            const cat = {
                id,
                url: "https://admin-tienda.pages.dev/c/" + id,
                nombre: hist?.nombre || "",
                createdAt: hist?.createdAt || null,
                expiresAt: hist?.expiresAt || null,
                activo,
                prods: hist?.data?.prods?.length || 0,
                vistas: views?.count || 0,
                ultimaVista: views?.last || null,
                primeraVista: views?.first || null,
            };
            catalogos.push(cat);

            if (activo && (!catalogoActivo || hist.createdAt > catalogoActivo.createdAt)) {
                catalogoActivo = cat;
            }
        });

        // Ordenar del más reciente al más antiguo
        catalogos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return new Response(JSON.stringify({
            totalCatalogos: ids.length,
            totalVistas,
            ultimaVista,
            catalogoActivo,
            catalogos,
        }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
