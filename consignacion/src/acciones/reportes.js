// Reportes: historial de ventas, cierres mensuales, estadísticas y visitas
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { generarCierreMes } from "../lib/cierre-mensual.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";

export async function accionesReportes({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "GET_HISTORIAL_VENTAS": {
      if (!esAdmin) return forbidden();
      const [vd, peds, consig, vends] = await Promise.all([
        sb.getAll("ventas_directas"),
        sb.getAll("pedidos"),
        sb.getAll("consignacion"),
        sb.getAll("vendedores")
      ]);
      const vendMap = new Map(vends.map(v => [v.codigo, v]));

      // Consignación / afiliados: una fila por cada venta INDIVIDUAL real,
      // tomada de vendedores[].historialVentas — tiene la fecha real en
      // que se vendió (no la de entrega de la pieza al vendedor), y
      // sobrevive a CERRAR_CORTE (que resetea el contador vivo
      // consignacion.vendido, pero no toca historialVentas). Antes esta
      // lista se armaba leyendo consignacion.vendido directamente: usaba
      // la fecha de ENTREGA en vez de la de venta, y una venta parcial
      // desaparecía del historial apenas se hacía el corte del vendedor
      // (porque vendido volvía a 0 ahí).
      const cubiertosPorHistorial = new Set();
      const desdeHistorialVentas = [];
      vends.forEach(v => {
        const esAfiliadoSinStock = v.tipo === "afiliado" && !v.recibeFisico;
        (Array.isArray(v.historialVentas) ? v.historialVentas : []).forEach(h => {
          if (h.consignacionId) cubiertosPorHistorial.add(h.consignacionId);
          desdeHistorialVentas.push({
            id: h.id || `HV_${v.codigo}_${h.fecha}`,
            fecha: h.fecha,
            tipo: esAfiliadoSinStock ? "afiliado_sin_stock" : "consignacion",
            cliente: v.codigo || "—", telefono: "",
            afiliadoNombre: v.nombre || v.codigo || "",
            total: parseFloat(h.precio || 0) * parseInt(h.cantidad || 1),
            estado: "pagado",
            saldoPendiente: 0,
            items: JSON.stringify([{ nombre: h.nombre || h.codigo, codigo: h.codigo, cantidad: h.cantidad, precio: h.precio }]),
            nota: h.migrado ? "Fecha aproximada (migrada desde la fecha de entrega)" : ""
          });
        });
      });
      // Respaldo — piezas con vendido>0 que todavía no tienen su registro
      // individual (nunca corrió MIGRAR_HISTORIAL_VENTAS_ANTIGUAS, o algún
      // camino viejo no llegó a dejar historial): se agregan igual, con la
      // fecha de entrega como mejor aproximación disponible, para que la
      // venta no desaparezca en silencio del historial.
      const sinHistorialVentas = consig.filter(c => parseInt(c.vendido) > 0 && !cubiertosPorHistorial.has(c.id)).map(c => {
        const vend = vendMap.get(c.vendedor);
        const esAfiliadoSinStock = vend?.tipo === "afiliado" && !vend?.recibeFisico;
        return {
          id: c.id, fecha: c.fecha,
          tipo: esAfiliadoSinStock ? "afiliado_sin_stock" : "consignacion",
          cliente: c.vendedor || "—", telefono: "",
          afiliadoNombre: vend?.nombre || c.vendedor || "",
          total: parseFloat(c.precio || 0) * parseInt(c.vendido || 1),
          estado: "pagado",
          saldoPendiente: 0,
          items: JSON.stringify([{ nombre: c.nombre || c.codigo, codigo: c.codigo, cantidad: c.vendido, precio: c.precio }]),
          nota: "Fecha aproximada (sin registro individual — fecha de entrega)"
        };
      });

      const unificadas = [
        ...vd.map(v => ({
          id: v.id, fecha: v.fecha, tipo: "directa",
          cliente: v.cliente || "—", telefono: v.telefono || "",
          total: parseFloat(v.total || 0),
          estado: v.estado || "pagado",
          saldoPendiente: parseFloat(v.saldoPendiente || 0),
          items: v.items || "[]",
          nota: v.nota || "",
          metodoPago: v.metodoPago || "",
          // Faltaban estos — sin ellos, el recibo generado DESDE el
          // Historial (no el que sale justo al confirmar la venta) no
          // podía mostrar el desglose de descuento ni "Envío: GRATIS".
          subtotal: v.subtotal != null ? parseFloat(v.subtotal) : undefined,
          descuento: parseFloat(v.descuento || 0),
          costoEnvio: parseFloat(v.costoEnvio || 0),
          departamentoEnvio: v.departamentoEnvio || "",
          direccionEnvio: v.direccionEnvio || "",
          tipo_venta: v.tipo || "contado",
          enganche: parseFloat(v.enganche || 0)
        })),
        ...peds.map(p => ({
          id: p.numeroPedido || p.id, fecha: p.fecha, tipo: "catalogo",
          cliente: p.cliente || "—", telefono: p.telefono || "",
          total: parseFloat(p.total || 0),
          estado: p.estado || "pendiente",
          saldoPendiente: 0,
          items: JSON.stringify(
            (p.productos || "").split(",").filter(Boolean).map(x => ({ nombre: x.trim() }))
          ),
          nota: p.municipio || ""
        })),
        ...desdeHistorialVentas,
        ...sinHistorialVentas
      ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      result = { ok: true, ventas: unificadas };
      break;
    }

    case "CERRAR_MES": {
      if (!esAdmin) return forbidden();
      const ahoraCM = new Date();
      // Por defecto cierra el MES ANTERIOR (el actual sigue corriendo) —
      // d.anio/d.mes (mes 1-indexado) permiten forzar un mes específico.
      let anioCM, mesCM0;
      if (d.anio != null && d.mes != null) {
        anioCM = parseInt(d.anio); mesCM0 = parseInt(d.mes) - 1;
      } else {
        mesCM0 = ahoraCM.getUTCMonth() - 1; anioCM = ahoraCM.getUTCFullYear();
        if (mesCM0 < 0) { mesCM0 = 11; anioCM -= 1; }
      }
      const cierreCM = await generarCierreMes(sb, anioCM, mesCM0);
      const cfgCM = await sb.get("config", "cierres_mensuales");
      const listaCM = (cfgCM && Array.isArray(cfgCM.lista)) ? cfgCM.lista.filter(c => c.id !== cierreCM.id) : [];
      listaCM.push(cierreCM);
      listaCM.sort((a, b) => b.id.localeCompare(a.id));
      await sb.set("config", "cierres_mensuales", { lista: listaCM });
      result = { ok: true, cierre: cierreCM };
      break;
    }

    case "GET_CIERRES_MENSUALES": {
      if (!esAdmin) return forbidden();
      const cfgGCM = await sb.get("config", "cierres_mensuales");
      result = { ok: true, cierres: (cfgGCM && Array.isArray(cfgGCM.lista)) ? cfgGCM.lista : [] };
      break;
    }

    case "GET_ESTADISTICAS": {
      if (!esAdmin) return forbidden();
      const pedsStat = await sb.getAll("pedidos");
      // Destinos
      const destinos = {};
      pedsStat.forEach(p => {
        const lugar = (p.municipio || p.departamento || "Sin especificar").trim();
        if (!lugar || lugar === "—") return;
        destinos[lugar] = (destinos[lugar] || 0) + 1;
      });
      const topDestinos = Object.entries(destinos)
        .sort((a,b) => b[1]-a[1]).slice(0,10)
        .map(([lugar, total]) => ({ lugar, total }));
      // Métodos de pago
      const pagos = {};
      pedsStat.forEach(p => {
        const m = (p.metodoPago || "Sin especificar").trim();
        pagos[m] = (pagos[m] || 0) + 1;
      });
      const topPagos = Object.entries(pagos)
        .sort((a,b) => b[1]-a[1])
        .map(([metodo, total]) => ({ metodo, total }));
      // Pedidos pendientes +2 días
      const hace2 = Date.now() - 2*24*60*60*1000;
      const alertas = pedsStat.filter(p =>
        (p.estado === "Pendiente" || p.estado === "En camino") &&
        new Date(p.fecha).getTime() < hace2
      ).length;
      result = { ok: true, topDestinos, topPagos, alertas };
      break;
    }

    case "REGISTRAR_VISITA": {
      // Público — se llama desde el catálogo en cada visita
      const hoy = new Date().toISOString().slice(0, 10); // "2026-06-08"
      let vis = await sb.get("config", "visitas_catalogo");
      if (!vis) vis = { total: 0, porDia: {} };
      vis.total = (vis.total || 0) + 1;
      vis.porDia = vis.porDia || {};
      vis.porDia[hoy] = (vis.porDia[hoy] || 0) + 1;
      // Mantener solo los últimos 30 días para no inflar el registro
      const dias = Object.keys(vis.porDia).sort();
      if (dias.length > 30) dias.slice(0, dias.length - 30).forEach(d => delete vis.porDia[d]);
      await sb.set("config", "visitas_catalogo", vis);
      result = { ok: true };
      break;
    }

    case "GET_VISITAS": {
      if (!esAdmin) return forbidden();
      const vis = await sb.get("config", "visitas_catalogo") || { total: 0, porDia: {} };
      const hoy = new Date().toISOString().slice(0, 10);
      const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const visitasHoy    = vis.porDia?.[hoy] || 0;
      const visitasSemana = Object.entries(vis.porDia || {})
        .filter(([dia]) => dia >= hace7)
        .reduce((s, [, n]) => s + n, 0);
      result = { ok: true, total: vis.total || 0, hoy: visitasHoy, semana: visitasSemana, porDia: vis.porDia || {} };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
