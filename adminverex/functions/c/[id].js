export async function onRequest(context) {
    const id = context.params.id;
    if (!id) return new Response("Not Found", { status: 404 });

    const raw = await context.env.CATALOGS.get(id);
    if (!raw) {
        return new Response(
            `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:3rem">
            <h2>⏰ Catálogo no encontrado</h2>
            <p>Este enlace expiró o no es válido.</p></body></html>`,
            { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } }
        );
    }

    const baseUrl = new URL(context.request.url);
    const origin   = `${baseUrl.protocol}//${baseUrl.host}`;

    const catalogoRes = await fetch(`${origin}/catalogo.html`);
    let html = await catalogoRes.text();

    // Build OG tags with absolute URLs for WhatsApp/social previews
    let catalogNombre = "Catálogo VEREX";
    let catalogDesc = "La expresión de tu mejor versión";
    let data = null;
    try { data = JSON.parse(raw); } catch(_) {}

    // El banner de afiliado es global (uno solo para todos sus catálogos) —
    // se inyecta aquí en cada carga, así una edición del admin aplica de
    // inmediato a todos los links de afiliado ya compartidos, sin regenerarlos.
    // Va ANTES de armar la descripción para que la promo de la vista previa
    // incluya este banner también, no solo el que trae el catálogo guardado.
    if (data && data.afiliado) {
        try {
            const rawBanner = await context.env.CATALOGS.get("__banner_afiliado_global__");
            if (rawBanner) {
                const b = JSON.parse(rawBanner);
                data.banner = (b.activo && b.txt) ? { txt: b.txt, sub: b.sub, color: b.color } : null;
            }
        } catch(_) {}
    }

    if (data) {
        if (data.nombre) catalogNombre = `Catálogo VEREX · ${data.nombre}`;

        // Descripción dinámica con filtros del catálogo
        const partes = [];

        // Promo activa PRIMERO — antes solo se veía al abrir el catálogo;
        // el cliente decidía si tocar el link sin enterarse de que hay una
        // promoción corriendo. Mismo cálculo que usa catalogo.html para
        // armar el banner, resumido a una sola línea de texto.
        const promoCarrito = data.promoCarrito || (data.promo2x50 ? { tipo: "2x50" } : null);
        if (promoCarrito) {
            if (promoCarrito.tipo === "2x50") partes.push("🎁 2do producto al 50% OFF");
            else if (promoCarrito.tipo === "3x2") partes.push("🎁 3x2 — la 3ra pieza GRATIS");
            else if (promoCarrito.tipo === "montoFijo") partes.push(`🎁 $${(parseFloat(promoCarrito.montoFijo)||0).toFixed(2)} de descuento`);
            else if (promoCarrito.tipo === "escalonado") {
                const max = [...(promoCarrito.escalones||[])].sort((a,b)=>b.pct-a.pct)[0];
                if (max) partes.push(`🎁 Hasta ${max.pct}% de descuento`);
            }
        }
        const envioGratisDesde = parseFloat(data.envioGratisDesde) || 0;
        if (envioGratisDesde > 0) partes.push(`🚚 Envío GRATIS desde $${envioGratisDesde.toFixed(2)}`);
        if (data.regaloSorpresa && data.regaloSorpresa.monto > 0) partes.push(`🎁 Regalo sorpresa desde $${parseFloat(data.regaloSorpresa.monto).toFixed(2)}`);
        if (data.banner?.txt) partes.push(data.banner.txt);

        if (data.prods?.length) partes.push(`${data.prods.length} producto${data.prods.length !== 1 ? "s" : ""}`);
        const catLabels = { AN:"Anillos", PU:"Pulseras", CD:"Cadenas", AR:"Aretes", CJ:"Conjuntos", DR:"Dijes", AL:"Alianzas", AC:"Accesorios" };
        const cats = [...new Set((data.prods || []).map(p => catLabels[p.cat] || p.cat).filter(Boolean))];
        if (cats.length && cats.length <= 3) partes.push(cats.join(", "));
        const tallas = (data.talla || "").split(",").filter(Boolean);
        if (tallas.length) partes.push("Talla " + tallas.join(", "));
        if (data.nota_interna) partes.push(data.nota_interna);
        if (partes.length) catalogDesc = partes.join(" · ");
    }
    const rawFinal = data ? JSON.stringify(data) : raw;

    const ogTags = `
<meta property="og:type"        content="website">
<meta property="og:title"       content="${catalogNombre}">
<meta property="og:description" content="${catalogDesc}">
<meta property="og:image"       content="${origin}/images/logo.jpg">
<meta property="og:image:width" content="1500">
<meta property="og:image:height" content="750">
<meta name="twitter:card"       content="summary_large_image">
<meta name="twitter:image"      content="${origin}/images/logo.jpg">
<script>window.__CATALOG_DATA__ = ${rawFinal};</script>`;

    html = html.replace("</head>", ogTags + "\n</head>");

    // Also update <title> with the catalog name
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${catalogNombre}</title>`);

    // Incrementar contador de vistas en background (no bloquea la respuesta)
    context.waitUntil((async () => {
        try {
            const vKey = "__views__" + id;
            const raw = await context.env.CATALOGS.get(vKey);
            const v = raw ? JSON.parse(raw) : { count: 0, first: null, last: null };
            v.count = (v.count || 0) + 1;
            v.last  = Date.now();
            if (!v.first) v.first = Date.now();
            await context.env.CATALOGS.put(vKey, JSON.stringify(v));
        } catch(_) {}
    })());

    return new Response(html, {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
    });
}
