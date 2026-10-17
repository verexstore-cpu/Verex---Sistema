// Reservas de stock de pedidos: vigencia y liberación
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

// ── VIGENCIA DE LA RESERVA DE UN LEAD ──────────────────────────────
// 30 min por defecto: si el cliente no completa el pedido, la pieza vuelve a
// stock rápido. Excepción: pedidos USA pagados con PayPal.me — PayPal no le
// avisa al sistema cuando el cliente paga, así que el pedido queda "sin pagar"
// hasta que el admin revisa PayPal y lo marca a mano; con solo 30 min el
// pedido se cancelaba solo aunque el cliente ya hubiera pagado. Esos tienen
// 12 h. Los de tarjeta (Wompi) siguen en 30 min: el webhook los confirma en
// segundos. El método se deduce del link de pago que armó el catálogo
// (mismo formato que valida ENVIAR_PEDIDO_USA).
export const RESERVA_NORMAL_MS = 30 * 60 * 1000;

export const RESERVA_LOCAL_MS = 24 * 3600 * 1000;

   // pedidos de afiliados / catálogo local: los confirma el admin a mano, no se pagan en línea
export const RESERVA_PAYPAL_USA_MS = 12 * 3600 * 1000;

export const RE_PAYPAL_ME_LINK = /^https:\/\/paypal\.me\/[A-Za-z0-9_.]{1,50}\/\d+\.\d{2}[A-Z]{0,3}$/;

export const RESERVA_PAYPAL_CHECKOUT_MS = 2 * 3600 * 1000;

   // el cliente tiene tiempo de aprobar el pago en PayPal; luego se confirma sola
export function ttlReservaLeadMs(d) {
  if (!d || d.pais !== "US") return RESERVA_LOCAL_MS;
  if (d && d.pais === "US" && /^[A-Z0-9]{8,30}$/.test(d.paypalOrderId || "")) return RESERVA_PAYPAL_CHECKOUT_MS;
  return (d && d.pais === "US" && RE_PAYPAL_ME_LINK.test(d.pagoLink || "")) ? RESERVA_PAYPAL_USA_MS : RESERVA_NORMAL_MS;
}

// Devuelve a stock la reserva exacta de un lead (de dónde salió: tienda y/o bodega). Usa el código CONFIRMADO si el
// admin cambió la pieza al confirmar el envío (si no, se repondría una pieza distinta a la que se apartó).
export async function liberarReservaLead(sb, lead) {
  if (!(lead.reservaDescTienda || lead.reservaDescBodega)) return false;
  await sb.liberar(lead.codigoConfirmado || lead.codigo, lead.reservaDescTienda || 0, lead.reservaDescBodega || 0);
  return true;
}

// Repone el stock reservado de un pedido de la tienda (tabla "pedidos"): al cancelarlo, marcarlo "No entregado" o eliminarlo.
// Con el detalle exacto (reservas) se repone donde salió; en pedidos viejos, todo vuelve a tienda. Marca stockLiberado.
export async function liberarStockPedido(sb, ped) {
  let items = [];
  try { items = typeof ped.items === "string" ? JSON.parse(ped.items) : (ped.items || []); } catch (_) {}
  if (Array.isArray(ped.reservas) && ped.reservas.length) {
    for (const r of ped.reservas) {
      if (!r.codigo) continue;
      try { await sb.liberar(r.codigo, r.descTienda || 0, r.descBodega || 0); } catch (_) {}
      try { await sb.update("stock", r.codigo, { enCatalogo: true }); } catch (_) {}
    }
  } else {
    for (const item of items) {
      if (!item.codigo) continue;
      const prod = await sb.get("stock", item.codigo);
      if (!prod) continue;
      const qty = parseInt(item.cantidad || 1);
      await sb.update("stock", item.codigo, {
        stock_reservado: Math.max(0, (parseInt(prod.stock_reservado)||0) - qty),
        stock_tienda:    (parseInt(prod.stock_tienda)||0) + qty,
        enCatalogo:      true
      });
    }
  }
  await sb.update("pedidos", ped.numeroPedido, { stockLiberado: true });
}

// ── RESERVAS DE STOCK: liberar las vencidas ────────────────────────
// Un lead "interesado" o "reportado" con reservaExpiraEn ya pasada nunca
// llegó a que un admin lo confirmara (cliente no completó el pago, cambió de
// opinión, etc.) — se repone la pieza a stock y se marca el lead como
// cancelado (mismo estado que una cancelación manual), para que no quede
// "atascada" como no disponible para siempre. Corre cada 5 min (ver
// scheduled() arriba y el cron en wrangler.toml).
export async function liberarReservasVencidas(sb) {
  const ahora = Date.now();
  let leads;
  try { leads = await sb.getAll("leads"); }
  catch (e) { console.error("liberarReservasVencidas: no se pudo leer leads", e); return; }

  // Pedidos locales (no USA) creados cuando el plazo era de 30 min: se les respeta el de 24 h desde que se hicieron.
  const venceEn = l => {
    let t = new Date(l.reservaExpiraEn).getTime();
    if (l.pais !== "US" && l.fecha) t = Math.max(t, new Date(l.fecha).getTime() + RESERVA_LOCAL_MS);
    return t;
  };
  const vencidos = leads.filter(l =>
    (l.estado === "interesado" || l.estado === "reportado") &&
    l.reservaExpiraEn && venceEn(l) < ahora
  );

  for (const lead of vencidos) {
    try {
      if (lead.reservaDescTienda || lead.reservaDescBodega) {
        await sb.liberar(lead.codigo, lead.reservaDescTienda || 0, lead.reservaDescBodega || 0);
      }
      const historial = [...(lead.historial || []), {
        estado: "cancelado", fecha: new Date().toISOString(), motivo: "Reserva vencida sin confirmar"
      }];
      await sb.update("leads", lead.id, {
        estado: "cancelado", historial, vencidoEn: new Date().toISOString(),
        reservaExpiraEn: null, reservaDescTienda: 0, reservaDescBodega: 0
      });
    } catch (eLib) {
      console.error("liberarReservasVencidas: error con lead " + lead.id, eLib);
    }
  }
}
