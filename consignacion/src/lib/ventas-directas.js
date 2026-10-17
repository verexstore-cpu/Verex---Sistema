// Ventas directas: precio realmente pagado por pieza y cambios
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

// ── VENTAS DIRECTAS: PRECIO REALMENTE PAGADO POR PIEZA ────────────
// El descuento de una venta directa vive a nivel de venta (subtotal /
// descuento / total), no por pieza. Para poder cambiar una pieza sabiendo
// cuánto pagó el cliente POR ELLA, cada item guarda `precioPagado`: su precio
// unitario ya con su parte del descuento, repartido proporcional al precio de
// lista. Las ventas anteriores a esto no lo tienen — se les calcula igual al
// momento de necesitarlo.
export const r2VD = n => Math.round((parseFloat(n) || 0) * 100) / 100;

export const r4VD = n => Math.round((parseFloat(n) || 0) * 10000) / 10000;

// Rellena `precioPagado` SOLO en los items que no lo tienen; los que ya lo
// tienen (ej. una pieza agregada o cambiada sin descuento) no se tocan.
export function completarPrecioPagadoVD(items, descuento) {
  let base = 0, yaDescontado = 0;
  for (const it of items) {
    const linea = (parseFloat(it.precio) || 0) * (parseInt(it.cantidad) || 1);
    if (it.precioPagado == null) base += linea;
    else yaDescontado += linea - (parseFloat(it.precioPagado) || 0) * (parseInt(it.cantidad) || 1);
  }
  const ratio = base > 0
    ? Math.min(1, Math.max(0, ((parseFloat(descuento) || 0) - yaDescontado) / base))
    : 0;
  return items.map(it => it.precioPagado != null
    ? it
    : { ...it, precioPagado: r4VD((parseFloat(it.precio) || 0) * (1 - ratio)) });
}

// Calcula un cambio de piezas (una o varias) sobre una venta directa SIN
// escribir nada: valida, y devuelve los items nuevos, los movimientos de
// stock y los montos. Sirve tanto para mostrar el desglose antes de
// confirmar (soloCalcular) como para aplicarlo — así lo que se ve es
// exactamente lo que se guarda, y si alguna pieza falla no queda un cambio a
// medias. Cada cambio: { codigoViejo, codigoNuevo, aplicaDescuento }.
export async function planearCambioVD(sb, vd, cambios) {
  let itemsOrig = [];
  try { itemsOrig = JSON.parse(vd.items || "[]"); } catch (_) {}
  const items = completarPrecioPagadoVD(itemsOrig, vd.descuento);
  if (!cambios.length) return { error: "No hay piezas para cambiar" };

  const stocks = {}; // código → fila de stock, leída una sola vez
  const getStock = async c => (c in stocks) ? stocks[c] : (stocks[c] = await sb.get("stock", c));
  const vistos = new Set(), lineas = [], devuelve = {}, necesita = {};
  const itemsNuevos = [...items];
  let difTotal = 0, difSubtotal = 0, difDescuento = 0;

  for (const c of cambios) {
    const codigoViejo = String(c.codigoViejo || "").trim();
    const codigoNuevo = String(c.codigoNuevo || "").trim();
    if (!codigoViejo) return { error: "Falta el producto que se devuelve" };
    if (!codigoNuevo) return { error: "Falta el código del producto nuevo para " + codigoViejo };
    if (codigoViejo === codigoNuevo) return { error: codigoViejo + ": el producto nuevo es igual al que se devuelve" };
    if (vistos.has(codigoViejo)) return { error: codigoViejo + " está repetido en el cambio" };
    vistos.add(codigoViejo);

    const idx = items.findIndex(it => it.codigo === codigoViejo);
    if (idx === -1) return { error: "Ese producto no está en esta venta (" + codigoViejo + ")" };
    const itemViejo = items[idx];
    const cant = parseInt(itemViejo.cantidad) || 1;

    const sNuevo = await getStock(codigoNuevo);
    if (!sNuevo) return { error: "El producto nuevo (" + codigoNuevo + ") no existe en stock" };
    await getStock(codigoViejo);

    devuelve[codigoViejo] = (devuelve[codigoViejo] || 0) + cant;
    necesita[codigoNuevo] = (necesita[codigoNuevo] || 0) + cant;

    // Lo que el cliente pagó por la pieza vieja vs. lo que cuesta la nueva.
    // La nueva NO hereda el descuento salvo que se pida (aplicaDescuento).
    const listaViejo = (parseFloat(itemViejo.precio) || 0) * cant;
    const pagadoViejo = (parseFloat(itemViejo.precioPagado) || 0) * cant;
    const descViejo = listaViejo - pagadoViejo;
    const precioNuevo = parseFloat(sNuevo.precio) || 0;
    const listaNuevo = precioNuevo * cant;
    const descNuevo = c.aplicaDescuento === true && listaViejo > 0 ? listaNuevo * (descViejo / listaViejo) : 0;
    const pagadoNuevo = listaNuevo - descNuevo;

    difTotal += pagadoNuevo - pagadoViejo;
    difSubtotal += listaNuevo - listaViejo;
    difDescuento += descNuevo - descViejo;

    itemsNuevos[idx] = {
      ...itemViejo,
      codigo: codigoNuevo,
      nombre: sNuevo.nombre_base || sNuevo.nombre || codigoNuevo,
      precio: precioNuevo,
      precioPagado: r4VD(pagadoNuevo / cant),
      cambiadoDe: codigoViejo,
      fechaCambio: new Date().toISOString() // para que el recibo marque que esta pieza no es de la fecha original
    };
    lineas.push({
      codigoViejo, nombreViejo: itemViejo.nombre || codigoViejo, cantidad: cant,
      precioViejo: r2VD(pagadoViejo / cant), descuentoViejo: r2VD(descViejo),
      codigoNuevo, nombreNuevo: itemsNuevos[idx].nombre,
      precioNuevo: r2VD(precioNuevo), descuentoNuevo: r2VD(descNuevo),
      aplicaDescuento: c.aplicaDescuento === true,
      diferencia: r2VD(pagadoNuevo - pagadoViejo)
    });
  }

  // Stock: cada código se toca UNA vez (si dos cambios comparten código, sumar
  // en vez de pisarse). Lo devuelto vuelve a bodega; lo nuevo sale de bodega
  // primero y luego de tienda. Una pieza que se devuelve en este mismo cambio
  // cuenta como disponible para otra.
  const fila = c => ({
    bodega: parseInt(stocks[c].stock_bodega) || 0,
    tienda: parseInt(stocks[c].stock_tienda) || 0,
    vendido: parseInt(stocks[c].stock_vendido) || 0
  });
  const cur = {};
  for (const c of new Set([...Object.keys(devuelve), ...Object.keys(necesita)])) {
    if (stocks[c]) cur[c] = fila(c);
  }
  for (const [c, n] of Object.entries(devuelve)) {
    if (!cur[c]) continue;
    cur[c].bodega += n;
    cur[c].vendido = Math.max(0, cur[c].vendido - n);
  }
  for (const [c, n] of Object.entries(necesita)) {
    if (cur[c].bodega + cur[c].tienda < n) {
      return { error: `Sin stock suficiente de ${c} (hay ${cur[c].bodega + cur[c].tienda}, se necesitan ${n})` };
    }
    const deBodega = Math.min(n, cur[c].bodega);
    cur[c].bodega -= deBodega;
    cur[c].tienda = Math.max(0, cur[c].tienda - (n - deBodega));
    cur[c].vendido += n;
  }
  const stockUpdates = {};
  for (const [c, f] of Object.entries(cur)) {
    stockUpdates[c] = { stock_bodega: f.bodega, stock_tienda: f.tienda, stock_vendido: f.vendido };
  }

  const diferencia = r2VD(difTotal);
  const saldoCrudo = (parseFloat(vd.saldoPendiente) || 0) + diferencia;
  return {
    items: itemsNuevos, lineas, stockUpdates, diferencia,
    total: Math.max(0, r2VD((parseFloat(vd.total) || 0) + diferencia)),
    subtotal: Math.max(0, r2VD((parseFloat(vd.subtotal) || 0) + difSubtotal)),
    descuento: Math.max(0, r2VD((parseFloat(vd.descuento) || 0) + difDescuento)),
    saldo: Math.max(0, r2VD(saldoCrudo)),
    // Si la pieza nueva vale menos de lo que el cliente ya tenía pagado, el
    // saldo no baja de 0 pero le sobra plata: se avisa en vez de perderse.
    aFavorCliente: saldoCrudo < 0 ? r2VD(-saldoCrudo) : 0
  };
}
