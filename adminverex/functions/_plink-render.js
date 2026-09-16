import { escapeHtml, escapeForScript } from "./_html-safe.js";

// Las fotos se suben tal cual las manda el vendedor, sin ningún realce —
// esto le agrega nitidez (e-sharpen) de ImageKit solo al mostrarla en la
// vista previa (OG), sin tocar la foto guardada.
function ikSharp(url) {
    if (!url || !url.includes("imagekit.io")) return url;
    return url.includes("?tr=") ? url + ",e-sharpen" : url + "?tr=e-sharpen";
}

// Arma el HTML de un link de producto/selección — lo comparten p/[codigo].js
// (codigo/exp/desc/af/wa vienen directo en la URL) y l/[id].js (los mismos
// datos, pero resueltos desde un link corto guardado en KV). Consulta el
// stock EN VIVO en cada visita (a diferencia del catálogo /c/[id], que
// congela los productos al momento de compartir) para que precio/stock
// siempre estén al día sin importar cuánto tiempo lleve circulando el link.
export async function renderPLink({ codigo, exp, desc, af, wa, origin }) {
    const prodRes = await fetch(origin + "/producto.html");
    let html = await prodRes.text();

    const codigos  = String(codigo || "").split(",").map(s => s.trim()).filter(Boolean);
    const descPct  = Math.min(90, Math.max(0, parseInt(desc) || 0));
    const expNum   = parseInt(exp) || 0;
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
                    ? `🔥 ${descPct}% OFF en ${basesUnicas.size} diseños seleccionados${expNum ? " · Oferta por tiempo limitado" : ""}`
                    : (() => {
                        const antes = parseFloat(p.precio) || 0;
                        const ahora = Math.round(antes * (1 - descPct / 100) * 100) / 100;
                        return `🔥 ${descPct}% OFF — antes $${antes.toFixed(2)} ahora $${ahora.toFixed(2)}`;
                      })();
            }
        }
    } catch (_) {}

    // nombre/foto vienen del stock guardado por el admin; codigo/af/wa pueden
    // venir DIRECTO de la URL o de un registro en KV editable solo por quien
    // tenga la contraseña de admin — de cualquier forma, sin escapar, una
    // comilla rompe el atributo y un "</script>" literal cierra el tag e
    // inyecta HTML/JS en el navegador de quien abra el link.
    const nombreSafe      = escapeHtml(nombre);
    const fotoSafe        = escapeHtml(ikSharp(foto));
    const descripcionSafe = escapeHtml(descripcion);

    const ogTags = `
<meta property="og:type"        content="website">
<meta property="og:title"       content="${nombreSafe} · VEREX">
<meta property="og:description" content="${descripcionSafe}">
<meta property="og:image"       content="${fotoSafe}">
<script>
window.__PRODUCTO_CODIGO__ = ${escapeForScript(JSON.stringify(codigo || ""))};
window.__PRODUCTO_EXP__    = ${JSON.stringify(expNum)};
window.__PRODUCTO_DESC__   = ${JSON.stringify(descPct)};
window.__PRODUCTO_AF__     = ${escapeForScript(JSON.stringify(af || ""))};
window.__PRODUCTO_WA__     = ${escapeForScript(JSON.stringify(wa || ""))};
</script>`;

    html = html.replace("</head>", ogTags + "\n</head>");
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${nombreSafe} · VEREX</title>`);

    return html;
}
