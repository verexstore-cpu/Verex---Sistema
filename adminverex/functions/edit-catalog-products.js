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
        const nuevos = body?.nuevosProductos || [];
        if (!id) return new Response(JSON.stringify({ error: "Falta el id" }), { status: 400, headers });
        if (!nuevos.length) return new Response(JSON.stringify({ error: "Sin productos nuevos" }), { status: 400, headers });

        // Leer el registro histórico para tener los datos completos
        const rawHist = await context.env.CATALOGS.get("__hist__" + id);
        if (!rawHist) return new Response(JSON.stringify({ error: "No existe registro histórico para este link" }), { status: 404, headers });
        const hist = JSON.parse(rawHist);

        // Leer el catálogo activo para respetar el TTL restante
        const rawActivo = await context.env.CATALOGS.get(id, { type: "text", cacheTtl: 1 });
        if (!rawActivo) return new Response(JSON.stringify({ error: "El link ya expiró — usa Reactivar primero" }), { status: 404, headers });
        const dataActivo = JSON.parse(rawActivo);

        // Fusionar productos: los nuevos se agregan al final evitando duplicados por código
        const codigosExistentes = new Set((dataActivo.prods || []).map(p => p.c || p.n));
        const prodsFusion = [
            ...(dataActivo.prods || []),
            ...nuevos.filter(p => !codigosExistentes.has(p.c || p.n)),
        ];

        const dataActualizado = { ...dataActivo, prods: prodsFusion };

        // Calcular TTL restante para no acortar la vigencia original
        const ttlRestante = Math.max(1, Math.round((dataActivo.expiry - Date.now()) / 1000));

        // Re-PUT manteniendo el mismo id y la misma expiración
        await context.env.CATALOGS.put(id, JSON.stringify(dataActualizado), {
            expirationTtl: ttlRestante,
        });

        // Actualizar el historial con los productos nuevos
        const histActualizado = { ...hist, data: dataActualizado };
        await context.env.CATALOGS.put("__hist__" + id, JSON.stringify(histActualizado));

        return new Response(JSON.stringify({ ok: true, totalProductos: prodsFusion.length }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
}
