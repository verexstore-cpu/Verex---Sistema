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
    try {
        const data = JSON.parse(raw);
        if (data.nombre) catalogNombre = `Catálogo VEREX · ${data.nombre}`;
    } catch(_) {}

    const ogTags = `
<meta property="og:type"        content="website">
<meta property="og:title"       content="${catalogNombre}">
<meta property="og:description" content="La expresión de tu mejor versión">
<meta property="og:image"       content="${origin}/images/logo.jpg">
<meta property="og:image:width" content="1500">
<meta property="og:image:height" content="750">
<meta name="twitter:card"       content="summary_large_image">
<meta name="twitter:image"      content="${origin}/images/logo.jpg">
<script>window.__CATALOG_DATA__ = ${raw};</script>`;

    html = html.replace("</head>", ogTags + "\n</head>");

    // Also update <title> with the catalog name
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${catalogNombre}</title>`);

    return new Response(html, {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
    });
}
