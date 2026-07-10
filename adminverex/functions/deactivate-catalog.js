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
        const id = String(body?.id || "").trim();
        if (!id) {
            return new Response(JSON.stringify({ error: "Falta el id del catálogo" }), { status: 400, headers });
        }

        const existing = await context.env.CATALOGS.get(id);
        if (!existing) {
            return new Response(JSON.stringify({ error: "Ese link no existe o ya expiró" }), { status: 404, headers });
        }

        await context.env.CATALOGS.delete(id);

        return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
}
