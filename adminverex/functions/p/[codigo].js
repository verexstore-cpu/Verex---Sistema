import { renderPLink } from "../_plink-render.js";

export async function onRequest(context) {
    const codigo = context.params.codigo;
    if (!codigo) return new Response("Not Found", { status: 404 });

    const baseUrl = new URL(context.request.url);
    const origin  = `${baseUrl.protocol}//${baseUrl.host}`;

    const html = await renderPLink({
        codigo,
        exp:  baseUrl.searchParams.get("exp"),
        desc: baseUrl.searchParams.get("desc"),
        af:   baseUrl.searchParams.get("af"),
        wa:   baseUrl.searchParams.get("wa"),
        origin,
    });

    return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}
