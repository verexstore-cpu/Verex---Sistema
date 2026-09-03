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
        const { id, dias: diasRaw, expiresAt: expiresAtRaw, stripDescuento, stripPromos } = await context.request.json();
        if (!id) return new Response(JSON.stringify({ error: "id requerido" }), { status: 400, headers });

        const rawHist = await context.env.CATALOGS.get("__hist__" + id);
        if (!rawHist) return new Response(JSON.stringify({ error: "Catálogo original no encontrado" }), { status: 404, headers });

        const hist = JSON.parse(rawHist);
        const originalData = hist.data;
        if (!originalData?.prods) return new Response(JSON.stringify({ error: "Datos de productos no disponibles" }), { status: 400, headers });

        const newId = Array.from(crypto.getRandomValues(new Uint8Array(4)))
            .map(b => b.toString(36).padStart(2, "0"))
            .join("")
            .slice(0, 6);

        const createdAt = Date.now();
        // Preferir la fecha EXACTA que eligió el admin (expiresAt) en vez de
        // recalcularla a partir de "días", que redondeaba hacia arriba y
        // producía un vencimiento un día más tarde de lo seleccionado.
        const expiresAtElegida = parseInt(expiresAtRaw) || 0;
        const expiresAt = (expiresAtElegida > createdAt)
            ? expiresAtElegida
            : createdAt + Math.min(Math.max(parseInt(diasRaw) || 3, 1), 30) * 86400000;
        const dias = Math.max(1, Math.ceil((expiresAt - createdAt) / 86400000));
        const newData = { ...originalData, dias, expiry: expiresAt };
        // Eliminar customId para que el afiliado no sobreescriba su link fijo
        delete newData.customId;
        // El banner/descuento del catálogo original NO se copia por defecto sin
        // confirmar — una promo vieja podría ya no estar vigente. El admin
        // decide en el front si mantenerlo o no antes de llamar este endpoint.
        if (stripDescuento) { delete newData.banner; delete newData.descPct; }
        if (stripPromos) { delete newData.promoCarrito; delete newData.promo2x50; delete newData.envioGratisDesde; delete newData.regaloSorpresa; }
        // Las promos (descuento, 2x50/3x2/monto fijo, envío gratis, regalo
        // sorpresa) son SOLO para catálogos de Cliente, nunca de Afiliado —
        // esto se refuerza acá SIEMPRE, sin depender de que el cliente mande
        // stripPromos/stripDescuento correctamente, por si el catálogo
        // original ya las tenía puestas por error o de antes de esa regla.
        if (newData.afiliado) {
            delete newData.banner; delete newData.descPct;
            delete newData.promoCarrito; delete newData.promo2x50;
            delete newData.envioGratisDesde; delete newData.regaloSorpresa;
        }

        await context.env.CATALOGS.put(newId, JSON.stringify(newData), {
            expirationTtl: 60 * 60 * 24 * dias,
        });

        const newHist = {
            id: newId,
            tipo: originalData.afiliado ? "afiliado" : "cliente",
            nombre: originalData.nombre || "",
            afiliadoCodigo: originalData.afiliadoCodigo || "",
            createdAt,
            expiresAt,
            dias,
            data: newData,
            clonadoDe: id,
        };
        await context.env.CATALOGS.put("__hist__" + newId, JSON.stringify(newHist));

        return new Response(JSON.stringify({ url: "/c/" + newId }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
