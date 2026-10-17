// Movimientos de stock en bloque (pocas peticiones a Supabase)
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { Supabase } from "./supabase.js";

// ── DEVOLUCIÓN EN BLOQUE ───────────────────────────────────────────
// Antes: 5 peticiones a Supabase POR PRODUCTO (leer/actualizar consignación, leer/actualizar stock y
// una lectura extra del total) → con más de ~9 productos se pasaba del límite de 50 subrequests del
// plan gratuito ("Too many subrequests by single Worker invocation"). Ahora son ~8 peticiones sin
// importar cuántos productos: 2 lecturas en bloque, 2 escrituras en bloque y el registro.
//
// Garantías: (1) todo lo devuelto sube a stock_bodega y baja de stock_consignacion, con stock_total
// recalculado; (2) todo o nada: si falta un producto en Stock no se toca nada; si falla la escritura del
// stock se deshace la de consignación; (3) idempotente: reenviar el mismo devId no aplica dos veces.
export async function registrarDevolucionEnBloque(sb, d) {
  const itemsRaw = Array.isArray(d.items) ? d.items : [];
  const int = (v) => parseInt(v) || 0;
  const devIdOk = /^DEV_[A-Za-z0-9_-]{6,60}$/.test(String(d.devId || ""));
  const devId = devIdOk ? String(d.devId) : `DEV_${Date.now()}`;

  if (devIdOk) {
    const previo = await sb.get("devoluciones", devId);
    if (previo) return { ok: true, duplicado: true, devolucionId: devId, fecha: previo.fecha };
  }

  // Une líneas repetidas del mismo registro de consignación
  const lineas = new Map();
  for (const it of itemsRaw) {
    const id = String(it && it.id != null ? it.id : "");
    const cant = Math.max(0, int(it && it.cantidad));
    if (!id || cant <= 0) continue;
    const l = lineas.get(id) || { id, codigo: it.codigo, nombre: it.nombre, cantidad: 0, efectivo: 0 };
    l.cantidad += cant; lineas.set(id, l);
  }
  if (!lineas.size) return { ok: false, error: "No hay productos con cantidad para devolver" };

  const consDocs = new Map((await sb.getMany("consignacion", [...lineas.keys()])).map(c => [String(c.id), c]));
  const advertencias = [];
  const consNuevas = [], consOriginales = [], deltaPorCodigo = new Map();
  for (const l of lineas.values()) {
    const cons = consDocs.get(l.id);
    const codigo = String((cons && cons.codigo) || l.codigo || "");
    if (!codigo) return { ok: false, error: "Falta el código de un producto (id " + l.id + "). No se registró nada." };
    let efectivo = l.cantidad;
    if (cons) {
      const disponible = Math.max(0, int(cons.cantidad) - int(cons.vendido));
      if (efectivo > disponible) {
        advertencias.push(`${codigo}: se pidieron ${l.cantidad} pero solo había ${disponible} disponibles; se devolvieron ${disponible}`);
        efectivo = disponible;
      }
      const nuevaCant = int(cons.cantidad) - efectivo;
      consOriginales.push(cons);
      consNuevas.push({ ...cons, cantidad: nuevaCant, estado: nuevaCant <= int(cons.vendido) ? "devuelto" : "activo" });
    } else {
      advertencias.push(`${codigo}: no se encontró su registro de consignación; se devolvió igual a bodega`);
    }
    l.efectivo = efectivo; l.codigoFinal = codigo; if (!l.nombre && cons) l.nombre = cons.nombre;
    if (efectivo > 0) deltaPorCodigo.set(codigo, (deltaPorCodigo.get(codigo) || 0) + efectivo);
  }

  const stockDocs = new Map((await sb.getMany("stock", [...deltaPorCodigo.keys()])).map(s => [String(s.id), s]));
  const sinStock = [...deltaPorCodigo.keys()].filter(c => !stockDocs.has(c));
  if (sinStock.length) {
    return { ok: false, error: "Estos productos no existen en Stock, así que no se pueden regresar a bodega: " + sinStock.join(", ") + ". No se registró nada; desmárcalos e inténtalo de nuevo." };
  }
  const stockNuevos = [], stockOriginales = [], devuelto = [];
  for (const [codigo, delta] of deltaPorCodigo) {
    const st = stockDocs.get(codigo);
    const nuevo = { ...st,
      stock_bodega:       int(st.stock_bodega) + delta,
      stock_consignacion: Math.max(0, int(st.stock_consignacion) - delta) };
    nuevo.stock_total = Supabase.COMPONENTES_STOCK.reduce((a, c) => a + int(nuevo[c]), 0);
    stockOriginales.push(st); stockNuevos.push(nuevo);
    devuelto.push({ codigo, cantidad: delta, stock_bodega: nuevo.stock_bodega });
  }

  const fecha = new Date().toISOString();
  // El historial guarda lo REALMENTE devuelto (no lo pedido) y su total de unidades. Se escribe ANTES de tocar
  // consignación/stock: sirve de candado por devId (un reenvío se detecta como duplicado) y, si no se puede guardar,
  // no se aplica nada.
  const registro = [...lineas.values()].filter(l => l.efectivo > 0).map(l => ({ id: l.id, codigo: l.codigoFinal, nombre: l.nombre || "", cantidad: l.efectivo }));
  const totalUnidades = registro.reduce((a, x) => a + x.cantidad, 0);
  try {
    await sb.set("devoluciones", devId, { id: devId, vendedor: d.vendedor, fecha, total_unidades: totalUnidades, items: JSON.stringify(registro) });
  } catch (e) {
    return { ok: false, error: "No se pudo guardar el registro de la devolución; no se aplicó nada. Inténtalo de nuevo. (" + e.message + ")" };
  }
  const quitarRegistro = async () => { try { await sb.deleteMany("devoluciones", [devId]); } catch (e3) { console.error("REGISTRAR_DEVOLUCION: no se pudo quitar el registro", e3); } };
  try { await sb.setMany("consignacion", consNuevas); }
  catch (e) { await quitarRegistro(); return { ok: false, error: "No se pudo actualizar la consignación; no se registró la devolución. Inténtalo de nuevo. (" + e.message + ")" }; }
  try {
    await sb.setMany("stock", stockNuevos);
  } catch (e) {
    // Deshacer todo para no dejar piezas "devueltas" que no llegaron a bodega (incluye bloques de stock ya escritos)
    try { await sb.setMany("consignacion", consOriginales); }
    catch (e2) { console.error("REGISTRAR_DEVOLUCION: no se pudo deshacer consignación", e2); }
    try { await sb.setMany("stock", stockOriginales); }
    catch (e2) { console.error("REGISTRAR_DEVOLUCION: no se pudo restaurar el stock", e2); }
    await quitarRegistro();
    return { ok: false, error: "No se pudo actualizar el stock; no se registró la devolución. Inténtalo de nuevo. (" + e.message + ")" };
  }
  return { ok: true, devolucionId: devId, fecha, devuelto, registro, advertencias };
}

// ── VENTA DIRECTA: descuento atómico de inventario ─────────────────────────────────────────────────
// La venta física ya ocurrió, así que SIEMPRE se registra; lo que cambia es que el descuento de stock sale de la misma reserva
// atómica de la tienda online (reservar_stock_pedido: primero tienda, luego bodega, con bloqueo de fila). Si hay menos stock del
// vendido, se descuenta lo que haya y se informa en `faltantes` para que se revise el inventario (antes se descontaba de más
// sin aviso o, con dos ventas simultáneas, ambas "vendían" la misma unidad).
// La reserva suma a stock_reservado; aquí se pasa a stock_vendido y se recalcula stock_total.
export async function descontarStockVentaDirecta(sb, items) {
  const itemsSinStock = [], faltantes = [], pedido = new Map();
  for (const it of items) {
    if (!it || !it.codigo) { itemsSinStock.push("SIN_CODIGO"); continue; }
    const c = String(it.codigo); pedido.set(c, (pedido.get(c) || 0) + (parseInt(it.cantidad) || 1));
  }
  if (!pedido.size) return { itemsSinStock, faltantes };
  const fichas = new Map((await sb.getMany("stock", [...pedido.keys()])).map(x => [String(x.id), x]));
  const descontado = new Map(), clasico = new Set();
  for (const [codigo, cant] of pedido) {
    const f = fichas.get(codigo);
    if (!f) { itemsSinStock.push(codigo); continue; }
    let desc = 0;
    try {
      let r = await sb.reservar(codigo, cant);
      if (r && r.ok) desc = cant;
      else {                                                  // no alcanza: tomar lo que haya (máx. 2 intentos por carreras)
        for (let intento = 0; intento < 2 && !desc; intento++) {
          const fr = await sb.get("stock", codigo), disp = Math.max(0, _int(fr && fr.stock_tienda) + _int(fr && fr.stock_bodega));
          const parcial = Math.min(cant, disp); if (parcial <= 0) break;
          r = await sb.reservar(codigo, parcial); if (r && r.ok) desc = parcial;
        }
      }
    } catch (e) {
      // Si la reserva atómica falla por un error de comunicación/Supabase (no por falta de stock), no se deja la venta sin
      // descontar: se usa el descuento anterior (lee y escribe: primero tienda, luego bodega) para ESTE producto.
      console.error("descontarStockVentaDirecta: reservar falló, descuento clásico", codigo, e);
      try {
        const fr = await sb.get("stock", codigo), tienda = _int(fr && fr.stock_tienda), bodega = _int(fr && fr.stock_bodega);
        const dT = Math.min(tienda, cant), dB = Math.min(bodega, cant - dT);
        await sb.update("stock", codigo, { stock_tienda: tienda - dT, stock_bodega: bodega - dB });
        desc = dT + dB; clasico.add(codigo);
      } catch (e2) { console.error("descontarStockVentaDirecta: descuento clásico falló", codigo, e2); }
    }
    descontado.set(codigo, desc);
    if (desc < cant) faltantes.push({ codigo, vendido: cant, descontado: desc });
  }
  // Pasar de reservado a vendido y recalcular el total (lectura fresca, una sola petición)
  const frescas = new Map((await sb.getMany("stock", [...descontado.keys()])).map(x => [String(x.id), x]));
  for (const [codigo, desc] of descontado) {
    const fr = frescas.get(codigo); if (!fr) continue;
    const total = Supabase.COMPONENTES_STOCK.reduce((a, c) => a + _int(fr[c]), 0);
    await sb.update("stock", codigo, { stock_reservado: clasico.has(codigo) ? _int(fr.stock_reservado) : Math.max(0, _int(fr.stock_reservado) - desc), stock_vendido: _int(fr.stock_vendido) + (pedido.get(codigo) || 0), stock_total: total });
  }
  return { itemsSinStock, faltantes };
}

// ── MOVIMIENTOS DE STOCK EN BLOQUE ─────────────────────────────────
// Antes cada código/producto hacía de 2 a 4 peticiones a Supabase y el plan gratuito de Cloudflare limita a 50 por
// operación (~11-15 productos). Ahora: lectura en bloque + cálculo en memoria (en el mismo orden y con las mismas
// reglas que antes) + escritura en bloque. ~4 peticiones sin importar cuántos productos.
export const _int = (v) => parseInt(v) || 0;

export function conPatchStock(st, patch) {
  const n = { ...st, ...patch };
  if (Supabase.COMPONENTES_STOCK.some(c => patch[c] !== undefined)) n.stock_total = Supabase.COMPONENTES_STOCK.reduce((a, c) => a + _int(n[c]), 0);
  return n;
}

export async function cargarStockMap(sb, codigos) {
  return new Map((await sb.getMany("stock", (codigos || []).map(String))).map(x => [String(x.id), x]));
}

export async function stockAsignarTiendaEnBloque(sb, d) {
  const codigos = Array.isArray(d.codigos) ? d.codigos.map(String) : [];
  const stock = await cargarStockMap(sb, codigos), originales = new Map(stock), tocados = new Set();
  for (const codigo of codigos) {
    const s = stock.get(codigo); if (!s) continue;
    const disponible = _int(s.stock_bodega);
    const cant = Math.min(d.cantidad || 1, disponible);                       // no mover más de lo que hay
    if (cant <= 0) continue;
    stock.set(codigo, conPatchStock(s, { stock_bodega: disponible - cant, stock_tienda: _int(s.stock_tienda) + cant, enCatalogo: true, estado: "tienda" }));
    tocados.add(codigo);
  }
  if (tocados.size) {
    const orig = [...tocados].map(c => originales.get(c));
    try { await guardarStockAtomico(sb, orig, [...tocados].map(c => stock.get(c))); }
    catch (e) { return { ok: false, error: "No se pudo actualizar el stock (no se guardó nada): " + e.message }; }
  }
  return { ok: true };
}

export async function stockDevolverBodegaEnBloque(sb, d) {
  const codigos = Array.isArray(d.codigos) ? d.codigos.map(String) : [];
  const origen = d.origen || "tienda";
  const stock = await cargarStockMap(sb, codigos), originales = new Map(stock), tocados = new Set();
  for (const codigo of codigos) {
    const s = stock.get(codigo); if (!s) continue;
    const enOrigen = origen === "tienda" ? _int(s.stock_tienda) : _int(s.stock_consignacion);   // no inventar stock
    const cant = Math.min(d.cantidad || 1, enOrigen);
    if (cant <= 0) continue;                                                   // ya no hay nada que devolver
    const patch = { stock_bodega: _int(s.stock_bodega) + cant, estado: "bodega" };
    if (origen === "tienda") { patch.stock_tienda = enOrigen - cant; patch.enCatalogo = false; }
    else patch.stock_consignacion = enOrigen - cant;
    stock.set(codigo, conPatchStock(s, patch)); tocados.add(codigo);
  }
  if (tocados.size) {
    const orig = [...tocados].map(c => originales.get(c));
    try { await guardarStockAtomico(sb, orig, [...tocados].map(c => stock.get(c))); }
    catch (e) { return { ok: false, error: "No se pudo actualizar el stock (no se guardó nada): " + e.message }; }
  }
  return { ok: true };
}

/** Guarda stock; si falla a mitad (varios bloques de 100), restaura los originales de lo ya escrito y relanza el error. */
export async function guardarStockAtomico(sb, originales, nuevos) {
  try { await sb.setMany("stock", nuevos); }
  catch (e) {
    try { await sb.setMany("stock", originales); } catch (e2) { console.error("guardarStockAtomico: no se pudo restaurar", e2); }
    throw e;
  }
}

/** Escribe consignación y stock "todo o nada": si el stock falla, se restauran/borran las filas de consignación. */
export async function guardarConsignacionYStock(sb, consNuevos, stockDocs, stockOrig) {
  const prev = new Map((await sb.getMany("consignacion", consNuevos.map(c => c.id))).map(c => [String(c.id), c]));
  await sb.setMany("consignacion", consNuevos);
  try {
    if (stockDocs.length) await guardarStockAtomico(sb, stockOrig || [], stockDocs);
  } catch (e) {
    try {
      const restaurar = consNuevos.map(c => prev.get(String(c.id))).filter(Boolean);
      if (restaurar.length) await sb.setMany("consignacion", restaurar);
      const borrar = consNuevos.filter(c => !prev.has(String(c.id))).map(c => c.id);
      if (borrar.length) await sb.deleteMany("consignacion", borrar);
    } catch (e2) { console.error("guardarConsignacionYStock: no se pudo deshacer", e2); }
    throw e;
  }
}

export async function stockAsignarVendedorEnBloque(sb, d) {
  const codigos = Array.isArray(d.codigos) ? d.codigos.map(String) : [];
  const stock = await cargarStockMap(sb, codigos), originales = new Map(stock), tocados = new Set();
  const asignados = [], sinStock = [], consNuevos = [], ids = new Set();
  const ahora = Date.now(), fecha = new Date().toISOString();
  for (const codigo of codigos) {
    const s = stock.get(codigo);
    if (!s) { sinStock.push(codigo); continue; }
    const disponible = _int(s.stock_bodega);
    const cant = Math.min(d.cantidad || 1, disponible);
    if (cant <= 0) { sinStock.push(codigo); continue; }
    let id = `CONS_${ahora}_${codigo}_${Math.random().toString(36).slice(2, 7)}`; while (ids.has(id)) id += "x"; ids.add(id);
    consNuevos.push({ id, vendedor: d.vendedor, codigo, codigoBase: s.codigoBase || codigo, talla: s.talla || "", nombre: s.nombre || "",
      nombre_base: s.nombre_base || s.nombre || "", categoria: s.categoria || "", precio: s.precio || 0, cantidad: cant, vendido: 0,
      foto: s.foto || "", fecha, estado: "activo" });
    stock.set(codigo, conPatchStock(s, { stock_bodega: disponible - cant, stock_consignacion: _int(s.stock_consignacion) + cant, estado: "consignacion" }));
    tocados.add(codigo); asignados.push(codigo);
  }
  if (!consNuevos.length) return { ok: true, asignados, sinStock };
  try { await guardarConsignacionYStock(sb, consNuevos, [...tocados].map(c => stock.get(c)), [...tocados].map(c => originales.get(c))); }
  catch (e) { return { ok: false, error: "No se pudo asignar (no se guardó nada): " + e.message, asignados: [], sinStock: codigos }; }
  return { ok: true, asignados, sinStock };
}

export async function registrarEntregaEnBloque(sb, d) {
  const items = Array.isArray(d.items) ? d.items : [];
  const estadoInicial = d.borrador ? "borrador" : "activo";          // borrador: descuenta stock pero invisible hasta FINALIZAR_ENTREGA_VENDEDOR
  const fallidos = [], validos = [], usados = new Set();
  const ahora = Date.now(), fecha = new Date().toISOString();
  for (const item of items) {
    const codigo = item && item.codigo != null ? String(item.codigo) : "";
    if (!codigo) { fallidos.push({ codigo: "(sin código)", error: "falta el código del producto" }); continue; }
    const cant = _int(item.cantidad) || 1;
    if (cant < 1) { fallidos.push({ codigo, error: "cantidad inválida" }); continue; }
    const id = item.id || `CONS_${ahora}_${codigo}_${Math.random().toString(36).slice(2, 7)}`;
    if (usados.has(String(id))) { fallidos.push({ codigo, error: "registro repetido en la misma entrega" }); continue; }
    usados.add(String(id)); validos.push({ item, codigo, cant, id });
  }
  if (!validos.length) return { ok: fallidos.length === 0, guardados: [], fallidos };
  const stock = await cargarStockMap(sb, validos.map(v => v.codigo)), originales = new Map(stock), tocados = new Set();
  const consNuevos = [], guardados = [];
  for (const { item, codigo, cant, id } of validos) {
    consNuevos.push({ id, vendedor: d.vendedor, codigo, nombre: item.nombre, codigoBase: item.codigoBase || codigo, talla: item.talla || "",
      nombre_base: item.nombre_base || item.nombre, categoria: item.categoria || "", precio: item.precio || 0, cantidad: cant, vendido: 0,
      foto: item.foto || "", fecha, estado: estadoInicial });
    const s = stock.get(codigo);
    if (s) { stock.set(codigo, conPatchStock(s, { stock_bodega: Math.max(0, _int(s.stock_bodega) - cant), stock_consignacion: _int(s.stock_consignacion) + cant })); tocados.add(codigo); }
    guardados.push(codigo);
  }
  try { await guardarConsignacionYStock(sb, consNuevos, [...tocados].map(c => stock.get(c)), [...tocados].map(c => originales.get(c))); }
  catch (e) {
    const motivo = "No se pudo guardar la entrega (no se guardó nada): " + e.message;
    return { ok: false, guardados: [], fallidos: [...validos.map(v => ({ codigo: v.codigo, error: motivo })), ...fallidos] };
  }
  return { ok: fallidos.length === 0, guardados, fallidos };
}
