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
        // Listar todos los __hist__ entries
        let cursor = undefined;
        const byAfiliado = new Map(); // codigo -> Set of catalog ids

        do {
            const listed = await context.env.CATALOGS.list({ prefix: "__hist__", cursor, limit: 100 });
            for (const key of listed.keys) {
                const raw = await context.env.CATALOGS.get(key.name);
                if (!raw) continue;
                const hist = JSON.parse(raw);
                const codigo = hist.afiliadoCodigo;
                if (!codigo) continue;
                if (!byAfiliado.has(codigo)) byAfiliado.set(codigo, new Set());
                byAfiliado.get(codigo).add(hist.id);
            }
            cursor = listed.list_complete ? undefined : listed.cursor;
        } while (cursor);

        // Escribir/fusionar índices por afiliado
        let totalAfiliados = 0, totalCatalogos = 0;
        for (const [codigo, ids] of byAfiliado) {
            const idxKey = "__affiliate__" + codigo;
            const rawIdx = await context.env.CATALOGS.get(idxKey);
            const existing = rawIdx ? new Set(JSON.parse(rawIdx).ids) : new Set();
            ids.forEach(id => existing.add(id));
            await context.env.CATALOGS.put(idxKey, JSON.stringify({ ids: [...existing] }));
            totalAfiliados++;
            totalCatalogos += existing.size;
        }

        return new Response(JSON.stringify({
            ok: true,
            totalAfiliados,
            totalCatalogos,
            message: `Índice reconstruido: ${totalAfiliados} afiliado(s), ${totalCatalogos} catálogo(s) en total`
        }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
}
