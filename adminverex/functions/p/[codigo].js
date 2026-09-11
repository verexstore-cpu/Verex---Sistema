export async function onRequest(context) {
    const codigo = context.params.codigo;
    if (!codigo) return new Response("Not Found", { status: 404 });

    const baseUrl = new URL(context.request.url);
    const origin  = `${baseUrl.protocol}//${baseUrl.host}`;

    const prodRes = await fetch(origin + "/producto.html");
    let html = await prodRes.text();

    // Datos en vivo para las etiquetas OG (vista previa en WhatsApp/redes) —
    // el resto de la página igual los vuelve a pedir en el navegador del
    // cliente, así el precio/stock que ve siempre está actualizado.
    const codigos = codigo.split(",").map(s => s.trim()).filter(Boolean);
    let nombre = "Producto VEREX";
    let foto = `${origin}/images/logo.jpg`;
    try {
        const apiRes = await fetch("https://verex-api.verexstore.workers.dev/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion: "GET_STOCK" })
        });
        const data = await apiRes.json();
        const stock = data.stock || [];
        const p = stock.find(s => s.codigo === codigos[0]);
        if (p) {
            nombre = (p.nombre_base || p.nombre || nombre).trim();
            // Contar DISEÑOS distintos (por codigoBase), no códigos sueltos —
            // varias tallas del mismo anillo son un solo diseño, no varios
            // "productos más" en la vista previa.
            const basesUnicas = new Set(
                codigos.map(c => {
                    const s = stock.find(x => x.codigo === c);
                    return (s?.codigoBase || c);
                })
            );
            const extra = basesUnicas.size - 1;
            if (extra > 0) nombre += ` + ${extra} producto${extra > 1 ? "s" : ""} más`;
            if (p.foto) foto = p.foto;
        }
    } catch (_) {}

    const ogTags = `
<meta property="og:type"        content="website">
<meta property="og:title"       content="${nombre} · VEREX">
<meta property="og:description" content="La expresión de tu mejor versión">
<meta property="og:image"       content="${foto}">
<script>window.__PRODUCTO_CODIGO__ = ${JSON.stringify(codigo)};</script>`;

    html = html.replace("</head>", ogTags + "\n</head>");
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${nombre} · VEREX</title>`);

    return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}
