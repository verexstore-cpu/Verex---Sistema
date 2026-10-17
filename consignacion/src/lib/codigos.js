// Códigos y categorías: cambio de código seguro, auditoría de stock y de categorías
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { Supabase } from "./supabase.js";

// ── CATEGORÍAS: detecta productos mal clasificados (p. ej. un anillo en «Conjuntos») ─────────────────────────────
// Los anillos (sueltos, dúo o trío) son SIEMPRE «Anillos»; «Conjuntos» es otra cosa (collar + aretes, etc.). Dos reglas de alta
// confianza: 1) el nombre es de anillo/alianza/argolla y la categoría no es AN; 2) el código empieza con una categoría conocida
// distinta a la guardada. Solo propone: quien confirma es el usuario (CORREGIR_CATEGORIAS).
export const CATEGORIAS_TIENDA = { AN: "Anillos", CO: "Collares", AR: "Aretes", PU: "Pulseras", CJ: "Conjuntos", CD: "Cadenas", DJ: "Dijes", TB: "Tobilleras", RS: "Rosarios" };

// El Admin Tienda usaba otros códigos (CN conjunto, PL pulsera) y generaba «XX-1234» al azar; Stock usa CJ/PU y [CAT][MAT][NNN].
export const CATEGORIAS_ANTIGUAS = { CN: "CJ", CU: "CJ", PL: "PU" };

   // CU: también se usó para conjuntos (CUP001 Conjunto Magic Mickey…)
// Si la categoría guardada no existe en la tienda, se deduce por el nombre (igual que la tienda y Lyra)
export const CATEGORIA_POR_NOMBRE = [[/^\s*conjuntos?\b/i, "CJ"], [/^\s*(anillo|alianza|argolla|sortija)s?\b/i, "AN"], [/^\s*(collar|gargantilla)(es|s)?\b/i, "CO"],
  [/^\s*(aretes?|aros?|argollitas?|topos?)\b/i, "AR"], [/^\s*(pulsera|brazalete|esclava)s?\b/i, "PU"], [/^\s*dijes?\b/i, "DJ"], [/^\s*tobilleras?\b/i, "TB"], [/^\s*rosarios?\b/i, "RS"]];

// Categorías vigentes: las de arriba + las agregadas/renombradas desde el «Editor de la página» (config.categorias).
export async function categoriasTiendaActual(sb) {
  const out = { ...CATEGORIAS_TIENDA };
  try { const cfg = await sb.get("config", "settings"); for (const c of (cfg && Array.isArray(cfg.categorias) ? cfg.categorias : [])) if (c && /^[A-Z]{2}$/.test(String(c.codigo))) out[c.codigo] = String(c.es || c.codigo); } catch (_) {}
  return out;
}

// Valida la lista de categorías que llega desde el editor (se rechaza completa si algo no cumple)
export function validarCategorias(lista) {
  if (!Array.isArray(lista) || lista.length > 40) return "lista de categorías inválida";
  const vistos = new Set();
  for (const c of lista) {
    if (!c || typeof c !== "object") return "categoría inválida";
    if (!/^[A-Z]{2}$/.test(String(c.codigo || ""))) return `código inválido «${c.codigo}»: deben ser 2 letras mayúsculas`;
    if (vistos.has(c.codigo)) return `código repetido: ${c.codigo}`; vistos.add(c.codigo);
    if (!String(c.es || "").trim() || String(c.es).length > 40 || String(c.en || "").length > 40) return `nombre inválido en ${c.codigo}`;
  }
  return null;
}

export const _codigoFormatoAdmin = (c) => /^[A-Za-z]{2}-\d+/.test(String(c || ""));

export function analizarCategorias(items, cats) {
  cats = cats || CATEGORIAS_TIENDA;
  const activos = items.filter(p => p && p.estado !== "inactivo");
  const publicados = activos.filter(p => p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE");
  const cuenta = {}; for (const p of publicados) { const c = String(p.categoria || "").toUpperCase().trim() || "(sin categoría)"; cuenta[c] = (cuenta[c] || 0) + 1; }
  const dudosas = [];
  for (const p of activos) {
    const catRaw = String(p.categoria || "").toUpperCase().trim(), cat = CATEGORIAS_ANTIGUAS[catRaw] || catRaw, cod = String(p.codigo || p.id || ""), prefRaw = (cod.match(/^[A-Za-z]{2}/) || [""])[0].toUpperCase(), pref = CATEGORIAS_ANTIGUAS[prefRaw] || prefRaw;
    const nombre = String(p.nombre_base || p.nombre || ""), antiguo = _codigoFormatoAdmin(cod);
    let propuesta = null, motivo = "";
    if (/^\s*(anillo|alianza|argolla|sortija)s?\b/i.test(nombre) && cat !== "AN") { propuesta = "AN"; motivo = `Es un anillo («${nombre}») pero está en ${cats[cat] || cat || "sin categoría"}`; }
    else if (antiguo && pref === "CD" && /^\s*(collar|gargantilla)/i.test(nombre)) { propuesta = "CO"; motivo = `Es un collar («${nombre}») con código de cadena del Admin (${cod})`; }
    else if (cats[pref] && cat !== pref) { propuesta = pref; motivo = catRaw ? `El código empieza por ${prefRaw} pero su categoría es ${cats[catRaw] || catRaw}` : "Sin categoría"; }
    else if (antiguo && cats[cat]) { propuesta = cat; motivo = `Código con formato antiguo del Admin (${cod}): no coincide con el que genera Stock para la etiqueta`; }
    // Categoría guardada con un código viejo del Admin (CN/CU → CJ, PL → PU): la tienda la entiende, pero se deja con el código real
    else if (catRaw && catRaw !== cat && cats[cat]) { propuesta = cat; motivo = `Categoría antigua del Admin (${catRaw}): en la tienda es ${cats[cat]} (${cat})`; }
    // Categoría que la tienda no conoce: se propone la que dice el nombre
    else if (catRaw && !cats[cat]) { const n = CATEGORIA_POR_NOMBRE.find(([re]) => re.test(nombre)); if (n && cats[n[1]]) { propuesta = n[1]; motivo = `${catRaw ? `La categoría ${catRaw} no existe en la tienda` : "Sin categoría"}; por el nombre es ${cats[n[1]]}`; } }
    if (propuesta) dudosas.push({ codigo: cod, nombre, categoria: catRaw, propuesta, motivo, publicado: publicados.includes(p), codigoAntiguo: antiguo || !!CATEGORIAS_ANTIGUAS[prefRaw] });
  }
  return { publicados: publicados.length, porCategoria: cuenta, dudosas };
}

// ── CAMBIO DE CÓDIGO SEGURO ──────────────────────────────────────────────────────────────────────────────────
// Corrige el código de un diseño (todas sus tallas juntas) cuando está mal codificado (p. ej. un anillo con código CJ…).
// Formato del código: [CAT2][MAT1][NNN] + talla (ANP174T7). El código nuevo SIEMPRE lo asigna el sistema: el siguiente número libre
// de ese prefijo, mirando TODOS los productos (también inactivos, que conservan su código). Cada código nuevo se crea con
// insertIfAbsent (ON CONFLICT DO NOTHING): si alguien lo tomó a la vez, se deshace y se prueba el siguiente. Todo o nada.
// El producto viejo queda inactivo y en cero (reemplazadoPor) y el nuevo lleva codigoAnterior + etiquetaPendiente para que se
// cambie la etiqueta física. Las consignaciones activas pasan al código nuevo; pedidos y ventas pasadas quedan como histórico.
export const _baseDeCodigo = (c) => String(c || "").replace(/[DCU]?T\d+(\.\d+)?$/i, "").trim();

// Diseño de un set: la 2da pieza de dama de un trío se registra con "B" (ANL106BDT8) y pertenece al mismo diseño
// (ANL106), igual que en el Hub y en las tiendas.
export const _baseTrio = (c) => _baseDeCodigo(c).replace(/^(.+\d)B$/i, "$1");

export const _esPiezaB = (c) => /^.+\dB$/i.test(_baseDeCodigo(c));

// Piezas extra de una línea de set (caballero y 2da pieza de dama): solo códigos del MISMO diseño, sin repetir.
export function piezasExtraSet(item) {
  const base = _baseTrio(item && item.codigo).toUpperCase(), vistos = new Set([String(item && item.codigo || "").toUpperCase()]);
  return [item && item.codigoB, item && item.codigoCab].map(c => String(c || "").trim()).filter(c => {
    const u = c.toUpperCase();
    if (!c || c.length > 40 || vistos.has(u) || _baseTrio(c).toUpperCase() !== base) return false;
    vistos.add(u); return true;
  });
}

export function _planCambioCodigo(ctx, codigo, categoria, matForzado) {
  const cat = String(categoria || "").toUpperCase();
  if (!(ctx.cats || CATEGORIAS_TIENDA)[cat]) return { ok: false, codigo, error: "categoría inválida" };
  const base = _baseDeCodigo(codigo).toUpperCase();
  const skus = ctx.stock.filter(x => x.estado !== "inactivo" && _baseDeCodigo(x.codigo).toUpperCase() === base);
  if (!skus.length) return { ok: false, codigo, error: "el producto no existe o está inactivo" };
  const mm = /^[A-Z]{2}([A-Z])\d+$/.exec(base);
  const mat = String(skus[0].material || skus[0].nombre_base || skus[0].nombre || "").toLowerCase();
  const delCampo = mat.includes("laminado") ? "L" : mat.includes("oro") ? "O" : mat.includes("acero") ? "A" : mat.includes("reloj") ? "W" : mat.includes("plata") ? "P" : "X";
  const forz = String(matForzado || "").toUpperCase();
  // Letra de material: la que elige el usuario > la del código (si no es X) > la del campo material > X (sin definir)
  const matChar = /^[POLAW]$/.test(forz) ? forz : (mm && mm[1] !== "X") ? mm[1] : delCampo;
  const prefijo = cat + matChar;
  let maxN = 0;
  for (const code of ctx.codigos) { const b = _baseDeCodigo(code).toUpperCase(); if (b.startsWith(prefijo) && /^\d+$/.test(b.slice(prefijo.length))) maxN = Math.max(maxN, parseInt(b.slice(prefijo.length), 10)); }
  for (const code of ctx.reservados) { const b = _baseDeCodigo(code).toUpperCase(); if (b.startsWith(prefijo) && /^\d+$/.test(b.slice(prefijo.length))) maxN = Math.max(maxN, parseInt(b.slice(prefijo.length), 10)); }
  for (let intento = 0; intento < 50; intento++) {
    const nuevoBase = prefijo + String(++maxN).padStart(3, "0");
    const mapa = skus.map(x => ({ viejo: x.codigo, nuevo: nuevoBase + String(x.codigo).slice(_baseDeCodigo(x.codigo).length) }));
    if (mapa.every(m => !ctx.codigos.has(m.nuevo.toUpperCase()) && !ctx.reservados.has(m.nuevo.toUpperCase()))) return { ok: true, codigo, base, nuevoBase, categoria: cat, mapa, skus, matChar, materialSinDefinir: matChar === "X" };
  }
  return { ok: false, codigo, error: "no se encontró un código libre" };
}

export async function _contextoCambioCodigo(sb) {
  const stock = await sb.getAll("stock");
  return { stock, cats: await categoriasTiendaActual(sb), codigos: new Set(stock.map(x => String(x.codigo || x.id).toUpperCase())), reservados: new Set() };
}

// Solo calcula (no escribe): qué código nuevo recibiría cada diseño
export async function sugerirCodigos(sb, items) {
  const ctx = await _contextoCambioCodigo(sb), out = [], vistos = new Set();
  for (const it of items) {
    const b = _baseDeCodigo(it.codigo).toUpperCase(); if (vistos.has(b)) continue; vistos.add(b);
    const p = _planCambioCodigo(ctx, it.codigo, it.categoria, it.material);
    if (p.ok) { p.mapa.forEach(m => ctx.reservados.add(m.nuevo.toUpperCase())); out.push({ ok: true, codigoBase: p.base, nuevoBase: p.nuevoBase, categoria: p.categoria, mapa: p.mapa, materialSinDefinir: p.materialSinDefinir }); }
    else out.push({ ok: false, codigo: it.codigo, error: p.error });
  }
  return out;
}

export async function cambiarCodigos(sb, items) {
  const ctx = await _contextoCambioCodigo(sb), consig = await sb.getAll("consignacion"), resultados = [], vistos = new Set();
  for (const it of items) {
    const b = _baseDeCodigo(it.codigo).toUpperCase(); if (vistos.has(b)) continue; vistos.add(b);
    let hecho = null;
    for (let intento = 0; intento < 3 && !hecho; intento++) {
      const p = _planCambioCodigo(ctx, it.codigo, it.categoria, it.material);
      if (!p.ok) { resultados.push({ ok: false, codigo: it.codigo, error: p.error }); hecho = "error"; break; }
      if (p.materialSinDefinir) { resultados.push({ ok: false, codigo: it.codigo, error: "el material no está definido: elige la letra (P plata, O oro, L laminado, A acero, W reloj)" }); hecho = "error"; break; }
      const ahora = new Date().toISOString(), creados = [];
      const matElegido = ({ P: "Plata", O: "Oro", L: "Oro laminado", A: "Acero", W: "Reloj" })[String(it.material || "").toUpperCase()] || "";   // si el usuario eligió la letra, el producto también recibe ese material
      let choque = false;
      try {
        for (const m of p.mapa) {                                                // 1) crear los nuevos (candado atómico)
          const viejo = p.skus.find(x => x.codigo === m.viejo), { id, ...datos } = viejo;
          const nuevo = { ...datos, ...(matElegido ? { material: matElegido } : {}), codigo: m.nuevo, codigoBase: p.nuevoBase, categoria: p.categoria, codigoAnterior: m.viejo, codigoCorregidoEn: ahora, etiquetaPendiente: true };
          if (!(await sb.insertIfAbsent("stock", m.nuevo, nuevo))) { choque = true; break; }
          creados.push(m.nuevo);
        }
      } catch (e) { if (creados.length) await sb.deleteMany("stock", creados).catch(() => {}); resultados.push({ ok: false, codigo: it.codigo, error: "no se pudo crear el código nuevo: " + e.message }); hecho = "error"; break; }
      if (choque) { if (creados.length) await sb.deleteMany("stock", creados).catch(() => {}); p.mapa.forEach(m => ctx.reservados.add(m.nuevo.toUpperCase())); continue; }   // otro lo tomó: siguiente número
      const viejos = new Map(p.mapa.map(m => [m.viejo, m.nuevo]));
      const consOrig = consig.filter(c => viejos.has(String(c.codigo))), consNuevas = consOrig.map(c => ({ ...c, codigo: viejos.get(String(c.codigo)), ...(c.codigoBase !== undefined ? { codigoBase: p.nuevoBase } : {}) }));
      try {
        if (consNuevas.length) await sb.setMany("consignacion", consNuevas);       // 2) consignaciones activas → código nuevo
        await sb.setMany("stock", p.skus.map(x => ({ ...x, estado: "inactivo", enCatalogo: false, reemplazadoPor: viejos.get(x.codigo), stock_bodega: 0, stock_tienda: 0, stock_consignacion: 0, stock_reservado: 0, stock_total: 0 })));   // 3) el viejo queda inactivo y en cero
      } catch (e) {                                                              // deshacer todo
        if (consOrig.length) await sb.setMany("consignacion", consOrig).catch(() => {});
        await sb.deleteMany("stock", creados).catch(() => {});
        resultados.push({ ok: false, codigo: it.codigo, error: "no se pudo completar el cambio (se deshizo): " + e.message }); hecho = "error"; break;
      }
      p.mapa.forEach(m => { ctx.codigos.add(m.nuevo.toUpperCase()); });
      try { await sb.set("cambios_codigo", `CC_${Date.now()}_${p.base}`, { fecha: ahora, desdeBase: p.base, haciaBase: p.nuevoBase, categoria: p.categoria, mapa: JSON.stringify(p.mapa), consignaciones: consNuevas.length }); } catch (_) {}
      resultados.push({ ok: true, desde: p.base, hacia: p.nuevoBase, categoria: p.categoria, mapa: p.mapa, consignaciones: consNuevas.length }); hecho = "ok";
    }
    if (!hecho) resultados.push({ ok: false, codigo: it.codigo, error: "otro cambio ocupó los códigos a la vez; inténtalo de nuevo" });
  }
  return resultados;
}

// Auditoría de consistencia del stock (solo lectura). La usan la acción AUDITORIA_STOCK y el cron diario.
export async function auditarStock(sb) {
  const [stockAud, consAud, vendAud] = await Promise.all([
    sb.getAll("stock"), sb.getAll("consignacion"), sb.getAll("vendedores")
  ]);
  const vendMapAud = new Map(vendAud.map(v => [v.codigo, v.nombre || v.codigo]));

  // Consignación real por código: suma de (cantidad - vendido) de
  // items activos, más el detalle de qué vendedor tiene cuánto.
  const consRealPorCodigo = new Map();
  for (const c of consAud) {
    if (c.estado !== "activo") continue;
    const restante = Math.max(0, (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0));
    if (restante <= 0) continue;
    const cod = String(c.codigo||"").toUpperCase();
    if (!consRealPorCodigo.has(cod)) consRealPorCodigo.set(cod, { total: 0, detalle: [] });
    const entry = consRealPorCodigo.get(cod);
    entry.total += restante;
    entry.detalle.push({
      id: c.id, vendedor: c.vendedor,
      vendedorNombre: vendMapAud.get(c.vendedor) || c.vendedor,
      vendedorExiste: vendMapAud.has(c.vendedor),
      cantidad: restante
    });
  }

  const discrepanciasConsignacion = [];
  for (const s of stockAud) {
    const cod = String(s.codigo||"").toUpperCase();
    const registrado = parseInt(s.stock_consignacion) || 0;
    const real = consRealPorCodigo.get(cod)?.total || 0;
    if (registrado !== real) {
      discrepanciasConsignacion.push({
        codigo: s.codigo, nombre: s.nombre || "",
        stock_consignacion_registrado: registrado,
        consignacion_real: real,
        diferencia: registrado - real,
        detalleVendedores: consRealPorCodigo.get(cod)?.detalle || []
      });
    }
  }

  // Chequeos de sanidad básicos: negativos no deberían existir nunca.
  const negativos = stockAud.filter(s =>
    (parseInt(s.stock_bodega)||0) < 0 || (parseInt(s.stock_tienda)||0) < 0 ||
    (parseInt(s.stock_consignacion)||0) < 0 || (parseInt(s.stock_reservado)||0) < 0
  ).map(s => ({
    codigo: s.codigo, nombre: s.nombre || "",
    stock_bodega: parseInt(s.stock_bodega)||0, stock_tienda: parseInt(s.stock_tienda)||0,
    stock_consignacion: parseInt(s.stock_consignacion)||0, stock_reservado: parseInt(s.stock_reservado)||0
  }));

  // Consignación "activa" pero cuyo código ya no existe en stock —
  // huérfanos que pueden confundir reportes futuros.
  const codigosStock = new Set(stockAud.map(s => String(s.codigo||"").toUpperCase()));
  const consHuerfanas = consAud.filter(c =>
    c.estado === "activo" && (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0) > 0 &&
    !codigosStock.has(String(c.codigo||"").toUpperCase())
  ).map(c => ({ id: c.id, codigo: c.codigo, vendedor: c.vendedor, vendedorNombre: vendMapAud.get(c.vendedor) || c.vendedor, cantidad: c.cantidad, vendido: c.vendido }));

  // Piezas cerradas con "Ya vendida" (MARCAR_CONSIGNACION_VENDIDA) que
  // en realidad nunca llegaron a contarse como venta real — típico de
  // confundir esa opción (pensada solo para piezas YA liquidadas
  // antes) con una venta nueva. Quedan invisibles para siempre: ya no
  // aparecen en el inventario activo del vendedor (por eso "no
  // aparece"), pero el stock nunca se movió y la comisión nunca se
  // contó, y sin este chequeo no hay ninguna pantalla en la app para
  // volver a encontrarlas.
  const cerradosSinContar = consAud.filter(c =>
    c.estado === "vendido" && (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0) > 0
  ).map(c => ({
    id: c.id, codigo: c.codigo, nombre: c.nombre || "",
    vendedor: c.vendedor, vendedorNombre: vendMapAud.get(c.vendedor) || c.vendedor,
    precio: c.precio || 0,
    cantidad: parseInt(c.cantidad)||0, vendido: parseInt(c.vendido)||0,
    pendiente: (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0)
  }));

  // stock_total debe ser bodega + tienda + consignación (así lo recalculan todas las operaciones)
  const totalDescuadrado = stockAud.filter(s => (parseInt(s.stock_total)||0) !== Supabase.COMPONENTES_STOCK.reduce((a, c) => a + (parseInt(s[c])||0), 0))
    .map(s => ({ codigo: s.codigo, nombre: s.nombre || "", stock_total: parseInt(s.stock_total)||0, suma: Supabase.COMPONENTES_STOCK.reduce((a, c) => a + (parseInt(s[c])||0), 0) }));

  const categoriasDudosas = analizarCategorias(stockAud, await categoriasTiendaActual(sb)).dudosas;
  return {
    ok: true,
    generadoEn: new Date().toISOString(),
    discrepanciasConsignacion, negativos, consHuerfanas, cerradosSinContar, totalDescuadrado, categoriasDudosas,
    resumen: {
      productosRevisados: stockAud.length,
      discrepancias: discrepanciasConsignacion.length,
      negativos: negativos.length,
      huerfanas: consHuerfanas.length,
      cerradosSinContar: cerradosSinContar.length,
      totalDescuadrado: totalDescuadrado.length,
      categoriasDudosas: categoriasDudosas.length
    }
  };
}
