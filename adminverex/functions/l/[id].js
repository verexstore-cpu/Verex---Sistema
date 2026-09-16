import { renderPLink } from "../_plink-render.js";

// Resuelve un link corto creado por save-plink.js y renderiza exactamente
// la misma página que /p/[codigo] (mismo helper, mismo stock en vivo) —
// la única diferencia es que codigo/exp/desc/af/wa salen de KV en vez de
// venir pegados en la URL.
export async function onRequest(context) {
    const id = context.params.id;
    if (!id) return new Response("Not Found", { status: 404 });

    const raw = await context.env.CATALOGS.get("plink_" + id);
    if (!raw) {
        return new Response(
            `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:3rem">
            <h2>⏰ Link no encontrado</h2>
            <p>Este enlace expiró o no es válido.</p></body></html>`,
            { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } }
        );
    }

    let record;
    try { record = JSON.parse(raw); } catch (_) {
        return new Response("Not Found", { status: 404 });
    }

    const baseUrl = new URL(context.request.url);
    const origin  = `${baseUrl.protocol}//${baseUrl.host}`;

    const html = await renderPLink({
        codigo: record.codigo,
        exp:    record.exp,
        desc:   record.desc,
        af:     record.af,
        wa:     record.wa,
        origin,
    });

    return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}
