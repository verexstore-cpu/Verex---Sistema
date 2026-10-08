import { esAdminValido, vendedorValido, noAutorizado } from "./_auth.js";

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
        let body = await context.request.json();
        if (!(await esAdminValido(body?._pass, context))) {
            // Inventario Sellers → "Compartir mi catálogo": el vendedor no tiene
            // la contraseña de admin, se valida con SU token (+ PIN). Solo puede
            // crear un catálogo propio: nombre, nota y código salen del registro
            // del vendedor (no de lo que mande el navegador), sin link fijo
            // (customId) ni promos, y con los productos limitados a los campos
            // que arma compartirMiCatalogo().
            const vend = await vendedorValido(body?._vendedor, body?._token, body?._pin, context);
            if (!vend) return noAutorizado(cors);
            if (!Array.isArray(body.prods)) {
                return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers });
            }
            const codigoVend = String(vend.codigo || body._vendedor);
            const CAMPOS_PROD = ["n", "p", "i", "m", "cat", "c", "sizes", "sizesD", "sizesH", "par", "piezas",
                "pD", "pH", "cD", "cC", "avisoPieza", "bajoPedido", "tallasDisponibles"];
            body = {
                nombre: "Catálogo de " + (vend.nombre || "vendedor VEREX"),
                nota_interna: "Auto-generado por el vendedor " + codigoVend,
                afiliadoCodigo: codigoVend,
                dias: body.dias,
                prods: body.prods.slice(0, 500).map(pr => {
                    const o = {};
                    for (const k of CAMPOS_PROD) if (pr && pr[k] !== undefined) o[k] = pr[k];
                    return o;
                }),
            };
        }
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
        // La contraseña de admin (y el token/PIN del vendedor) vienen en el
        // body solo para autorizar — nunca se guardan: este objeto se publica
        // tal cual en la página del link (window.__CATALOG_DATA__).
        delete dataWithMeta._pass; delete dataWithMeta._vendedor;
        delete dataWithMeta._token; delete dataWithMeta._pin;

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
