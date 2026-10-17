// Cierre mensual de ventas
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

// ── CIERRE MENSUAL ────────────────────────────────────────────────
// Junta los 4 canales de venta (ecommerce, venta directa, consignación,
// afiliados sin stock) en un solo resumen del mes. Consignación y afiliados
// se sacan de historialVentas de cada vendedor (fecha real de cada venta,
// no la de entrega) — antes de la migración de historial, meses viejos
// pueden salir en 0 en esos dos canales porque ese detalle no existía.
export async function generarCierreMes(sb, anio, mesIndex0) {
  const inicio = Date.UTC(anio, mesIndex0, 1);
  const fin    = Date.UTC(anio, mesIndex0 + 1, 1);
  const enRango = f => { const t = new Date(f || 0).getTime(); return t >= inicio && t < fin; };

  const [peds, vd, todosVendCierre] = await Promise.all([
    sb.getAll("pedidos"), sb.getAll("ventas_directas"), sb.getAll("vendedores")
  ]);

  const ecommerceVentas = peds.filter(p => enRango(p.fecha));
  const ecommerceTotal  = ecommerceVentas.reduce((s, p) => s + (parseFloat(p.total) || 0), 0);

  const directaVentas = vd.filter(v => enRango(v.fecha));
  const directaTotal  = directaVentas.reduce((s, v) => s + (parseFloat(v.total) || 0), 0);

  let consignacionTotal = 0, consignacionCant = 0;
  let afiliadoSinStockTotal = 0, afiliadoSinStockCant = 0;
  const porVendedor = [];
  for (const v of todosVendCierre) {
    const hist = Array.isArray(v.historialVentas) ? v.historialVentas : [];
    const delMes = hist.filter(h => enRango(h.fecha));
    if (!delMes.length) continue;
    const totalV = delMes.reduce((s, h) => s + (parseFloat(h.precio) || 0) * (parseInt(h.cantidad) || 1), 0);
    const unidadesV = delMes.reduce((s, h) => s + (parseInt(h.cantidad) || 1), 0);
    const esAfiliadoSinStock = v.tipo === "afiliado" && !v.recibeFisico;
    if (esAfiliadoSinStock) { afiliadoSinStockTotal += totalV; afiliadoSinStockCant += unidadesV; }
    else { consignacionTotal += totalV; consignacionCant += unidadesV; }
    porVendedor.push({ vendedor: v.codigo, nombre: v.nombre, total: totalV, unidades: unidadesV, esAfiliadoSinStock });
  }
  porVendedor.sort((a, b) => b.total - a.total);

  // Ingreso REAL de VEREX este mes: ecommerce + venta directa + comisión que
  // cobra por afiliados sin stock (ese dinero ya entró a caja). Consignación
  // tradicional NO cuenta aquí — el vendedor cobró él primero y liquida
  // después, ese dinero no ha entrado a VEREX todavía.
  const ingresoRealVerex = ecommerceTotal + directaTotal + afiliadoSinStockTotal;
  const totalGeneral = ingresoRealVerex + consignacionTotal;

  return {
    id: `${anio}-${String(mesIndex0 + 1).padStart(2, "0")}`,
    anio, mes: mesIndex0 + 1,
    generadoEn: new Date().toISOString(),
    ecommerce:        { total: ecommerceTotal,      cantidad: ecommerceVentas.length },
    ventaDirecta:      { total: directaTotal,         cantidad: directaVentas.length },
    afiliadosSinStock:{ total: afiliadoSinStockTotal, cantidad: afiliadoSinStockCant },
    consignacion:      { total: consignacionTotal,    cantidad: consignacionCant },
    ingresoRealVerex, totalGeneral,
    porVendedor
  };
}
