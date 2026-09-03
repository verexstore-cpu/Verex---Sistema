export async function onRequest(context) {
    if (context.request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            }
        });
    }
    if (context.request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

    try {
        const body = await context.request.json();
        if (!body || !body.prods) {
            return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers });
        }

        const rawId = body.customId
            ? String(body.customId).toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
            : null;
        const id = rawId || Array.from(crypto.getRandomValues(new Uint8Array(4)))
            .map(b => b.toString(36).padStart(2, "0"))
            .join("")
            .slice(0, 6);

        const dias = Math.min(Math.max(parseInt(body.dias)||30, 1), 30);
        const createdAt = Date.now();
        const expiresAt = createdAt + dias * 86400000;
        const dataWithMeta = { ...body, expiry: expiresAt, dias };

        // Las promos (descuento, 2x50/3x2/monto fijo, envío gratis, regalo
        // sorpresa) son SOLO para catálogos de Cliente — nunca de Afiliado.
        // El front ya evita mandarlas para afiliados, pero se refuerza acá
        // igual por si acaso, en vez de confiar solo en el cliente.
        if (dataWithMeta.afiliado) {
            delete dataWithMeta.banner; delete dataWithMeta.descPct;
            delete dataWithMeta.promoCarrito; delete dataWithMeta.promo2x50;
            delete dataWithMeta.envioGratisDesde; delete dataWithMeta.regaloSorpresa;
        }

        await context.env.CATALOGS.put(id, JSON.stringify(dataWithMeta), {
            expirationTtl: 60 * 60 * 24 * dias,
        });

        // Registro permanente para el historial — sin TTL, no expira solo
        const hist = {
            id,
            tipo: body.afiliado ? "afiliado" : "cliente",
            nombre: body.nombre || "",
            afiliadoCodigo: body.afiliadoCodigo || "",
            createdAt,
            expiresAt,
            dias,
            data: dataWithMeta,
        };
        await context.env.CATALOGS.put("__hist__" + id, JSON.stringify(hist));

        // Mantener índice por afiliado para stats rápidas
        if (body.afiliadoCodigo) {
            const idxKey = "__affiliate__" + body.afiliadoCodigo;
            const rawIdx = await context.env.CATALOGS.get(idxKey);
            const idx = rawIdx ? JSON.parse(rawIdx) : { ids: [] };
            if (!idx.ids.includes(id)) idx.ids.push(id);
            await context.env.CATALOGS.put(idxKey, JSON.stringify(idx));
        }

        return new Response(JSON.stringify({ url: "/c/" + id }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
