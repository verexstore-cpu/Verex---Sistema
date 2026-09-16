import { esAdminValido, noAutorizado } from "./_auth.js";

// Genera un link corto (/l/ID) para un producto o selección puntual — misma
// idea que save-catalog.js, pero para el link "rápido" de Stock/Consignación
// (compartirProducto/compartirSeleccionados), que antes pegaba los códigos
// directo en la URL (/p/COD1,COD2,...?exp=...&desc=...) y con varias piezas
// quedaba una URL larguísima y fea para publicar en un Estado de WhatsApp.
// Reusa el namespace KV "CATALOGS" ya existente (prefijo "plink_" para no
// chocar con los ids de catálogo) en vez de pedir uno nuevo.
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
        if (!(await esAdminValido(body?._pass))) return noAutorizado(cors);
        if (!body || !body.codigo) {
            return new Response(JSON.stringify({ error: "Falta el código" }), { status: 400, headers });
        }

        const id = Array.from(crypto.getRandomValues(new Uint8Array(4)))
            .map(b => b.toString(36).padStart(2, "0"))
            .join("")
            .slice(0, 6);

        const exp = parseInt(body.exp) || 0;
        // TTL de la KV en base a la vigencia que ya eligió el usuario al
        // generar el link (1 o 3 días) — si por algo no viene, 7 días de
        // margen en vez de dejarlo indefinido.
        const ttlSeg = exp > Date.now()
            ? Math.max(3600, Math.ceil((exp - Date.now()) / 1000))
            : 7 * 86400;

        const record = {
            codigo: String(body.codigo),
            exp,
            desc: parseInt(body.desc) || 0,
            af: body.af || "",
            wa: body.wa || "",
        };
        await context.env.CATALOGS.put("plink_" + id, JSON.stringify(record), { expirationTtl: ttlSeg });

        return new Response(JSON.stringify({ id }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
