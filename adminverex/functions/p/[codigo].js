import { escapeHtml, escapeForScript } from "../_html-safe.js";

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
    // Mismos parámetros que lee producto.html en el navegador — se repiten
    // acá solo para armar una vista previa (OG) que ya adelante la oferta,
    // en vez del genérico "La expresión de tu mejor versión" de siempre.
    const descPct = Math.min(90, Math.max(0, parseInt(baseUrl.searchParams.get("desc")) || 0));
    const exp     = parseInt(baseUrl.searchParams.get("exp")) || 0;
    let nombre = "Producto VEREX";
    let foto = `${origin}/images/logo.jpg`;
    let descripcion = "La expresión de tu mejor versión";
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

            if (descPct > 0) {
                descripcion = extra > 0
                    ? `🔥 ${descPct}% OFF en ${basesUnicas.size} diseños seleccionados${exp ? " · Oferta por tiempo limitado" : ""}`
                    : (() => {
                        const antes  = parseFloat(p.precio) || 0;
                        const ahora  = Math.round(antes * (1 - descPct / 100) * 100) / 100;
                        return `🔥 ${descPct}% OFF — antes $${antes.toFixed(2)} ahora $${ahora.toFixed(2)}`;
                      })();
            }
        }
    } catch (_) {}

    // nombre viene del stock guardado por el admin y foto de ImageKit; codigo
    // viene DIRECTO de la URL (context.params.codigo) — sin escapar, una
    // comilla rompe el atributo y un "</script>" literal en cualquiera de
    // los tres cierra el tag e inyecta HTML/JS en el navegador de quien abra
    // el link (XSS reflejado vía URL manipulada, sin necesitar ningún
    // permiso de escritura).
    const nombreSafe = escapeHtml(nombre);
    const fotoSafe    = escapeHtml(foto);
    const descripcionSafe = escapeHtml(descripcion);

    const ogTags = `
<meta property="og:type"        content="website">
<meta property="og:title"       content="${nombreSafe} · VEREX">
<meta property="og:description" content="${descripcionSafe}">
<meta property="og:image"       content="${fotoSafe}">
<script>window.__PRODUCTO_CODIGO__ = ${escapeForScript(JSON.stringify(codigo))};</script>`;

    html = html.replace("</head>", ogTags + "\n</head>");
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${nombreSafe} · VEREX</title>`);

    return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}
