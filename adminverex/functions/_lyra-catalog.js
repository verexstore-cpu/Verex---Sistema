// Catálogos que crea Lyra (asistente de WhatsApp, proyecto verex-catalogo-us).
//
// Lyra no tiene la contraseña de admin: usa su propia llave (cabecera X-Lyra-Key = Secret
// LYRA_CATALOG_KEY, igual en los dos proyectos de Pages) que SOLO sirve para crear catálogos
// de Cliente con estas reglas, sin importar lo que mande:
//   - 1 a 3 días de validez, número oficial de VEREX, máximo 24 productos
//   - nada de afiliados, link fijo, catálogo USA ni receta
//   - promo solo con los campos conocidos y con topes
//   - máximo 3 catálogos por cliente al día y 300 en total al día
//   - marcado «Creado por Lyra» para verlo en Admin → Links

export const LYRA_WA = "71250725";          // = VEREX_WA_OFICIAL del Admin
export const LYRA_MAX_DIAS = 3;
export const LYRA_MAX_PRODS = 24;
export const LYRA_MAX_CLIENTE_DIA = 3;
export const LYRA_MAX_TOTAL_DIA = 300;

const CAMPOS_PROD = ["n", "p", "i", "m", "cat", "c", "sizes", "sizesD", "sizesH", "par", "piezas", "pD", "pH", "avisoPieza"];
const TIPOS_PROMO = ["2x50", "3x2", "montoFijo", "escalonado"];

const texto = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const numero = (v, min, max) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const tallas = v => Array.isArray(v) ? v.slice(0, 30).map(s => texto(s, 6)).filter(s => /^\d+(\.\d+)?$/.test(s)) : [];

export function igualSeguro(a, b) {
    a = String(a || ""); b = String(b || "");
    if (!a || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

function sanearProd(pr) {
    if (!pr || typeof pr !== "object") return null;
    const o = {};
    for (const k of CAMPOS_PROD) if (pr[k] !== undefined && pr[k] !== null) o[k] = pr[k];
    o.n = texto(o.n, 120);
    o.c = texto(o.c, 40);
    o.cat = texto(o.cat, 4).toUpperCase();
    o.m = texto(o.m, 40);
    const precio = numero(o.p, 0, 100000);
    if (!o.n || !o.c || !precio) return null;
    o.p = precio.toFixed(2);
    o.i = /^https:\/\//.test(String(o.i || "")) ? texto(o.i, 500) : "";
    o.sizes = tallas(o.sizes); o.sizesD = tallas(o.sizesD); o.sizesH = tallas(o.sizesH);
    o.par = o.par === true;
    o.piezas = o.par ? Math.round(numero(o.piezas, 2, 4) || 2) : null;
    o.pD = o.par && o.pD != null ? numero(o.pD, 0, 100000) : null;
    o.pH = o.par && o.pH != null ? numero(o.pH, 0, 100000) : null;
    o.avisoPieza = o.avisoPieza === true;
    return o;
}

function sanearPromo(b) {
    const out = {};
    const txt = texto(b.banner?.txt, 80);
    if (txt) {
        out.banner = { txt, sub: texto(b.banner?.sub, 120), color: /^#[0-9a-f]{3,8}$/i.test(String(b.banner?.color || "")) ? b.banner.color : "#C9A84C" };
        const pct = Math.round(numero(b.descPct, 0, 50) || 0);
        if (pct > 0) out.descPct = pct;               // igual que el Admin: el % solo va con banner
    }
    const pc = b.promoCarrito;
    if (pc && TIPOS_PROMO.includes(pc.tipo)) {
        if (pc.tipo === "montoFijo") {
            const montoFijo = numero(pc.montoFijo, 0, 500);
            const minimoCompra = numero(pc.minimoCompra, 0, 10000);
            if (montoFijo > 0) out.promoCarrito = { tipo: "montoFijo", montoFijo, ...(minimoCompra > 0 && { minimoCompra }) };
        } else if (pc.tipo === "escalonado") {
            const escalones = (Array.isArray(pc.escalones) ? pc.escalones : []).slice(0, 6)
                .map(e => ({ minCant: Math.round(numero(e?.minCant, 2, 50) || 0), pct: Math.round(numero(e?.pct, 0, 50) || 0) }))
                .filter(e => e.minCant >= 2 && e.pct > 0);
            if (escalones.length) out.promoCarrito = { tipo: "escalonado", escalones };
        } else out.promoCarrito = { tipo: pc.tipo };
    }
    const envio = numero(b.envioGratisDesde, 0, 10000);
    if (envio > 0) out.envioGratisDesde = envio;
    const rMonto = numero(b.regaloSorpresa?.monto, 0, 10000), rTexto = texto(b.regaloSorpresa?.texto, 80);
    if (rMonto > 0 && rTexto) out.regaloSorpresa = { monto: rMonto, texto: rTexto };
    return out;
}

/** Cuerpo que manda Lyra → catálogo de Cliente con las reglas de arriba (o { error }). */
export function sanearCatalogoLyra(b) {
    if (!b || typeof b !== "object") return { error: "Invalid payload" };
    const clienteRef = String(b.clienteRef || "");
    if (!/^[a-f0-9]{8,32}$/.test(clienteRef)) return { error: "clienteRef requerido" };
    const prods = (Array.isArray(b.prods) ? b.prods : []).slice(0, LYRA_MAX_PRODS).map(sanearProd).filter(Boolean);
    if (!prods.length) return { error: "Sin productos" };
    const nota = texto(b.nota_interna, 160);
    return {
        clienteRef,
        data: {
            nombre: texto(b.nombre, 60),
            talla: texto(b.talla, 20),
            wa: LYRA_WA,
            dias: Math.round(numero(b.dias, 1, LYRA_MAX_DIAS) || LYRA_MAX_DIAS),
            nota_interna: "🤖 Creado por Lyra (WhatsApp)" + (nota ? " · " + nota : ""),
            creadoPor: "lyra",
            ...sanearPromo(b),
            prods,
        },
    };
}

// Día en El Salvador (UTC-6, sin horario de verano) para los topes diarios.
export function diaSV(ts = Date.now()) {
    return new Date(ts - 6 * 3600_000).toISOString().slice(0, 10);
}

/** Cuenta un catálogo más para el cliente y para el total del día; false si ya llegó al tope. */
export async function cupoLyra(kv, clienteRef, ts = Date.now()) {
    const dia = diaSV(ts);
    const kCli = `__lyra_n__${clienteRef}__${dia}`, kTot = `__lyra_n__total__${dia}`;
    const [nCli, nTot] = (await Promise.all([kv.get(kCli), kv.get(kTot)])).map(v => parseInt(v) || 0);
    if (nCli >= LYRA_MAX_CLIENTE_DIA) return { ok: false, motivo: "tope_cliente" };
    if (nTot >= LYRA_MAX_TOTAL_DIA) return { ok: false, motivo: "tope_total" };
    const ttl = { expirationTtl: 2 * 86400 };
    await Promise.all([kv.put(kCli, String(nCli + 1), ttl), kv.put(kTot, String(nTot + 1), ttl)]);
    return { ok: true };
}
