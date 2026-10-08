import { esAdminValido, noAutorizado } from "./_auth.js";

// ═══════════════════════════════════════════════════════════════════
//  Catálogo ACTUAL de un vendedor (Nexus → "Ver Catálogo Actual").
//
//  Un mismo vendedor puede ser afiliado (productos que el admin le arma en
//  "Catálogo Afiliado", que VEREX despacha) y además tener piezas en
//  consignación (las tiene en la mano). Antes el botón solo abría el link fijo
//  de afiliado (/c/<nombre>) y, si había vencido o nunca se armó, el cliente
//  veía "Catálogo no encontrado" aunque el vendedor tuviera inventario.
//
//  Aquí se arma, en el MISMO link fijo, un catálogo combinado y al día:
//    - origen "consignacion" → lo que tiene en la mano (sale «✓ DISPONIBLE YA»).
//      Se lee en vivo del Worker (GET_CODIGOS_VENDEDOR), igual que el catálogo
//      que el vendedor comparte desde Inventario Sellers.
//    - origen "afiliado" → la selección del admin (sale «📦 BAJO PEDIDO»),
//      tomada del registro permanente __hist__<id> (sobrevive al vencimiento).
//  Si una pieza está en las dos listas, gana la de consignación (la tiene ya).
//  Vigencia 30 días; cada vez que se presiona el botón se renueva y se
//  actualiza con el inventario del momento.
// ═══════════════════════════════════════════════════════════════════

const WORKER = "https://verex-api.verexstore.workers.dev/";
const DIAS = 30;

function slugDe(nombre) {
    return String(nombre || "").toLowerCase()
        .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
        .replace(/ó/g, "o").replace(/ú/g, "u").replace(/ü/g, "u").replace(/ñ/g, "n")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// Misma forma de producto que arma compartirMiCatalogo() en Inventario Sellers.
function prodConsignacion(c) {
    return {
        n: c.nombre_base || c.nombre || "",
        p: parseFloat(c.precio || 0).toFixed(2),
        i: c.foto || "",
        m: c.material || "",
        cat: c.categoria || "",
        c: String(c.codigoBase || c.codigo || "").replace(/-\d+$/, ""),
        sizes: c.talla ? [String(c.talla)] : [],
        sizesD: [], sizesH: [],
        par: false, piezas: null, pD: null, pH: null, cD: null, cC: null,
        avisoPieza: false,
        bajoPedido: !!c.bajoPedido,
        tallasDisponibles: c.tallasDisponibles || [],
        origen: "consignacion",
    };
}

const claveProd = p => String(p.c || "").toUpperCase() + "|" + String((p.sizes && p.sizes[0]) || "").trim();

export async function onRequest(context) {
    const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
    const headers = { "Content-Type": "application/json", ...cors };
    if (context.request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (context.request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await context.request.json();
        if (!(await esAdminValido(body?._pass, context))) return noAutorizado(cors);

        const vend = body?.vendedor || {};
        const codigo = String(vend.codigo || "").trim();
        const id = slugDe(body?.slug || vend.nombre);
        if (!codigo || !id) {
            return new Response(JSON.stringify({ ok: false, error: "Falta el vendedor" }), { status: 400, headers });
        }

        // 1) Lo que tiene en consignación AHORA (en vivo).
        const rw = await fetch(WORKER, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion: "GET_CODIGOS_VENDEDOR", vendedor: codigo }),
        });
        const dw = await rw.json().catch(() => ({}));
        if (!dw?.ok) {
            return new Response(JSON.stringify({ ok: false, error: "No se pudo leer el inventario del vendedor" }), { status: 502, headers });
        }
        const consignacion = (dw.productos || []).map(prodConsignacion).filter(p => p.c);

        // 2) La selección de afiliado del admin (si existe), aunque el link haya vencido.
        const [rawHist, rawVivo] = await Promise.all([
            context.env.CATALOGS.get("__hist__" + id),
            context.env.CATALOGS.get(id),
        ]);
        let hist = null, base = null;
        try { hist = rawHist ? JSON.parse(rawHist) : null; } catch (_) {}
        try { base = rawVivo ? JSON.parse(rawVivo) : (hist?.data || null); } catch (_) { base = hist?.data || null; }
        // Un catálogo de CLIENTE con el mismo nombre no se toca: solo se combina con el de afiliado.
        if (base && hist && hist.tipo && hist.tipo !== "afiliado" && !base.mixto) base = null;

        const enConsignacion = new Set(consignacion.filter(p => !p.bajoPedido).map(claveProd));
        const afiliado = (base?.prods || [])
            .filter(p => p && p.origen !== "consignacion")
            .filter(p => !enConsignacion.has(claveProd(p)))
            .map(p => ({ ...p, origen: "afiliado" }));

        if (!consignacion.length && !afiliado.length) {
            return new Response(JSON.stringify({ ok: false, error: "sin_productos" }), { status: 404, headers });
        }

        // 3) Guardar en el link fijo, con los datos del catálogo de afiliado si había (WhatsApp, banner…).
        const createdAt = Date.now();
        const expiresAt = createdAt + DIAS * 86400000;
        const datos = { ...(base || {}) };
        delete datos._pass; delete datos._vendedor; delete datos._token; delete datos._pin;
        const data = {
            ...datos,
            nombre: datos.nombre || vend.nombre || "Vendedor VEREX",   // se muestra como «Distribuidor: <nombre>»
            wa: datos.wa || String(vend.telefono || "").replace(/\D/g, ""),
            afiliado: true,
            afiliadoCodigo: codigo,
            mixto: true,
            prods: [...consignacion, ...afiliado],
            expiry: expiresAt,
            dias: DIAS,
            actualizado: createdAt,
        };
        delete data.customId;

        await context.env.CATALOGS.put(id, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * DIAS });
        await context.env.CATALOGS.put("__hist__" + id, JSON.stringify({
            ...(hist || {}),
            id,
            tipo: "afiliado",
            nombre: data.nombre,
            afiliadoCodigo: codigo,
            createdAt: hist?.createdAt || createdAt,
            expiresAt,
            dias: DIAS,
            activo: true,
            data,
        }));
        const idxKey = "__affiliate__" + codigo;
        const rawIdx = await context.env.CATALOGS.get(idxKey);
        const idx = rawIdx ? JSON.parse(rawIdx) : { ids: [] };
        if (!idx.ids.includes(id)) { idx.ids.push(id); await context.env.CATALOGS.put(idxKey, JSON.stringify(idx)); }

        return new Response(JSON.stringify({
            ok: true, url: "/c/" + id,
            enMano: consignacion.filter(p => !p.bajoPedido).length,
            bajoPedido: consignacion.filter(p => p.bajoPedido).length + afiliado.length,
        }), { headers });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers });
    }
}
