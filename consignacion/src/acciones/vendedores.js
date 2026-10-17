// Vendedores: alta, tokens, firma de contrato, entregas y correcciones
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { pinIncorrecto } from "../lib/auth.js";
import { NO_MANEJADA, forbidden, json } from "../lib/http.js";
import { liberarReservaLead } from "../lib/reservas.js";
import { safeEq } from "../lib/seguridad.js";
import { corteVencido, validarVendedorToken } from "../lib/vendedores.js";

export async function accionesVendedores({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "GET_VENDEDORES": {
      if (!esAdmin) return forbidden();
      const docs = await sb.getAll("vendedores");
      result = { ok: true, vendedores: docs };
      break;
    }

    case "GUARDAR_VENDEDOR": {
      if (!esAdmin) return forbidden();
      await sb.set("vendedores", d.vendedor.codigo, d.vendedor);
      result = { ok: true };
      break;
    }

    case "ELIMINAR_VENDEDOR": {
      if (!esAdmin) return forbidden();
      // Cancelar los Leads pendientes de este vendedor/afiliado antes de
      // borrarlo — si no, quedan huérfanos apuntando a un código que ya
      // no existe (aparecen en las alertas sin nombre, solo el código).
      const leadsVend = await sb.getAll("leads");
      for (const l of leadsVend) {
        if (l.afiliado === d.codigo && (l.estado === "interesado" || l.estado === "reportado" || l.estado === "en_camino")) {
          // La pieza quedó apartada (reservada) desde que el cliente pidió — hay que devolverla a donde salió,
          // si no queda atrapada en el balde de reservado para siempre.
          let liberadoVend = false;
          try { liberadoVend = await liberarReservaLead(sb, l); } catch (eVend) { console.error("ELIMINAR_VENDEDOR: no se pudo liberar el lead " + l.id, eVend); }
          // Lead "en camino" de antes de la reserva exacta: sin detalle de origen, vuelve a bodega.
          if (!liberadoVend && l.estado === "en_camino") {
            const codigoRes = l.codigoConfirmado || l.codigo;
            const sRes = await sb.get("stock", codigoRes);
            if (sRes) {
              await sb.update("stock", codigoRes, {
                stock_reservado: Math.max(0, (parseInt(sRes.stock_reservado)||0) - 1),
                stock_bodega: (parseInt(sRes.stock_bodega)||0) + 1
              });
            }
          }
          const historial = [...(l.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), motivo: "Vendedor eliminado" }];
          await sb.update("leads", l.id, { estado: "cancelado", historial, reservaExpiraEn: null, reservaDescTienda: 0, reservaDescBodega: 0 });
        }
      }
      await sb.delete("vendedores", d.codigo);
      result = { ok: true };
      break;
    }

    case "GUARDAR_TOKEN": {
      if (!esAdmin) return forbidden();
      await sb.update("vendedores", d.vendedor, { tokenInventario: d.token });
      result = { ok: true };
      break;
    }

    case "GUARDAR_TOKEN_FIRMA": {
      if (!esAdmin) return forbidden();
      await sb.update("vendedores", d.vendedor, { tokenFirma: d.token });
      result = { ok: true };
      break;
    }

    case "GUARDAR_TOKEN_PEDIDOS": {
      if (!esAdmin) return forbidden();
      await sb.update("vendedores", d.vendedor, { tokenPedidos: d.token });
      result = { ok: true };
      break;
    }

    // Público — portal del afiliado para completar pedidos (protegido por token + PIN)
    case "GET_LEADS_PORTAL_AFILIADO": {
      const vend = await sb.get("vendedores", d.vendedor);
      if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      if (!vend.tokenPedidos || !safeEq(vend.tokenPedidos, d.token)) {
        result = { ok: false, error: "Link inválido" }; break;
      }
      // Si el afiliado tiene PIN configurado, validarlo
      if (await pinIncorrecto(sb, vend, d.pin, d.vendedor)) {
        result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
      }
      const todos = await sb.getAll("leads");
      const pendientes = todos.filter(l => l.afiliado === d.vendedor && l.estado === "interesado" && !l.cliente);
      result = { ok: true, leads: pendientes, vendedorNombre: vend.nombre, tienePin: !!vend.pin };
      break;
    }

    // Público — historial completo del afiliado (protegido por token + PIN)
    case "GET_HISTORIAL_AFILIADO": {
      const vend = await sb.get("vendedores", d.vendedor);
      if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      if (!vend.tokenPedidos || !safeEq(vend.tokenPedidos, d.token)) {
        result = { ok: false, error: "Link inválido" }; break;
      }
      if (await pinIncorrecto(sb, vend, d.pin, d.vendedor)) {
        result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
      }
      const todosH = await sb.getAll("leads");
      const mios = todosH.filter(l => l.afiliado === d.vendedor);
      const enCamino  = mios.filter(l => l.estado === "en_camino");
      const vendidos  = mios.filter(l => l.estado === "vendido" && !l.esCambio);
      // Tabla por tramos igual que el panel de consignación (RANGOS_COMISION_AFILIADO)
      const RANGOS_AFILIADO = [
        { min: 0,   pct: 20 },
        { min: 200, pct: 25 },
        { min: 400, pct: 30 },
      ];
      const totalVendido = vendidos.reduce((s, l) => s + (parseFloat(l.precio) || 0), 0);
      let pct;
      if (vend.comisionFija != null && vend.comisionFija !== "") {
        pct = parseFloat(vend.comisionFija);
      } else {
        const rango = RANGOS_AFILIADO.slice().reverse().find(r => totalVendido >= r.min);
        pct = rango ? rango.pct : RANGOS_AFILIADO[0].pct;
      }
      const vendidosConComision = vendidos.map(l => ({
        ...l,
        comision: Math.round((parseFloat(l.precio) || 0) * pct / 100 * 100) / 100
      }));
      result = { ok: true, enCamino, vendidos: vendidosConComision, comisionPct: pct, vendedorNombre: vend.nombre };
      break;
    }

    // Público — el afiliado completa un pedido (uno o más Leads del mismo
    // cliente) con nombre, teléfono y dirección. NO mueve stock ni genera
    // comisión — solo adjunta los datos; el admin sigue confirmando desde
    // Consignación → Leads como ya lo hacía, ahora con el pedido completo.
    case "COMPLETAR_PEDIDO_LEADS": {
      const vend = await sb.get("vendedores", d.vendedor);
      if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      if (!vend.tokenPedidos || !safeEq(vend.tokenPedidos, d.token)) {
        result = { ok: false, error: "Link inválido" }; break;
      }
      if (await pinIncorrecto(sb, vend, d.pin, d.vendedor)) {
        result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
      }
      const cliente = d.cliente || {};
      if (!cliente.nombre || !cliente.telefono || !cliente.departamento || !cliente.municipio || !cliente.direccion) {
        result = { ok: false, error: "Faltan datos del cliente" }; break;
      }
      const leadIds = Array.isArray(d.leadIds) ? d.leadIds : [];
      if (!leadIds.length) { result = { ok: false, error: "Selecciona al menos un producto" }; break; }

      const leads = [];
      for (const id of leadIds) {
        const lead = await sb.get("leads", id);
        if (lead && lead.afiliado === d.vendedor && lead.estado === "interesado" && !lead.cliente) leads.push(lead);
      }
      if (!leads.length) { result = { ok: false, error: "Esos productos ya no están disponibles para completar" }; break; }

      const subtotal = leads.reduce((s, l) => s + (parseFloat(l.precio) || 0), 0);
      let envio = subtotal >= 30 ? 0 : 2;
      try {
        const cfg = await sb.get("config", "settings");
        if (cfg?.reglasEnvio?.length) {
          const regla = cfg.reglasEnvio.slice().sort((a,b) => a.min - b.min).find(r => subtotal >= r.min && subtotal <= r.max);
          if (regla) envio = regla.costo;
        }
      } catch(_) {}
      const total = subtotal + envio;
      const pedidoId = "PEDAF_" + Date.now();
      const fecha = new Date().toISOString();

      for (const lead of leads) {
        const historial = [...(lead.historial || []), { estado: "pedido_completado", fecha }];
        await sb.update("leads", lead.id, {
          cliente, metodoPago: "efectivo", tipoPago: "contra_entrega",
          pedidoId, pedidoFecha: fecha,
          envioInfo: { subtotal, envio, total },
          historial
        });
      }
      result = { ok: true, pedidoId, subtotal, envio, total };
      break;
    }

    // Público — página de firma remota (sin sesión de admin, protegida por token)
    case "GET_VENDEDOR_FIRMA": {
      const vend = await sb.get("vendedores", d.vendedor);
      if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      if (!vend.tokenFirma || !safeEq(vend.tokenFirma, d.token)) {
        result = { ok: false, error: "Link inválido" }; break;
      }
      result = { ok: true, vendedor: {
        nombre: vend.nombre, codigo: vend.codigo, telefono: vend.telefono,
        dui: vend.dui || null,
        tipo: vend.tipo, comisionFija: vend.comisionFija ?? null,
        recibeFisico: vend.recibeFisico === true,
        firmaContrato: vend.firmaContrato || null,
        firmaContratoFecha: vend.firmaContratoFecha || null
      } };
      break;
    }

    case "FIRMAR_CONTRATO_REMOTO": {
      const vend = await sb.get("vendedores", d.vendedor);
      if (!vend) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      if (!vend.tokenFirma || !safeEq(vend.tokenFirma, d.token)) {
        result = { ok: false, error: "Link inválido" }; break;
      }
      if (vend.firmaContrato) { result = { ok: false, error: "Este contrato ya fue firmado" }; break; }
      if (!d.firma) { result = { ok: false, error: "Falta la firma" }; break; }
      const fecha = new Date().toISOString();
      await sb.update("vendedores", d.vendedor, { firmaContrato: d.firma, firmaContratoFecha: fecha });
      result = { ok: true, firmaContratoFecha: fecha };
      break;
    }

    case "CATALOGO_VENDEDOR": {
      const vendCod = d.vendedor;
      if (!vendCod) { result = { ok: false, razon: "no_encontrado" }; break; }
      const [vend, cons] = await Promise.all([
        sb.get("vendedores", vendCod),
        sb.query("consignacion", "vendedor", "==", vendCod),
      ]);
      // Vendedor no existe
      if (!vend) { result = { ok: false, razon: "no_encontrado" }; break; }
      // Catálogo no activado
      if (!vend.catalogoActivo) { result = { ok: false, razon: "no_activo" }; break; }
      // Validar 30 días desde último corte
      if (corteVencido(vend)) { result = { ok: false, razon: "vencido" }; break; }
      // Solo items activos con stock disponible
      const items = cons
        .filter(c => c.estado === "activo" && (parseInt(c.cantidad||0) - parseInt(c.vendido||0)) > 0)
        .map(c => ({
          codigo:    c.codigo,
          nombre:    c.nombre_base || c.nombre,
          precio:    c.precio,
          foto:      c.foto || "",
          categoria: c.categoria || "",
        }));
      result = {
        ok: true,
        vendedor: { nombre: vend.nombre, telefono: vend.telefono },
        items,
      };
      break;
    }

    case "VERIFICAR_TOKEN": {
      const vend = await sb.get("vendedores", d.vendedor);
      if (!vend) { result = { ok: false, razon: "no_encontrado" }; break; }
      // Sin token guardado (nunca tuvo link, o se cerró) nadie entra: antes,
      // String(undefined) === "undefined" dejaba pasar a quien mandara ese texto.
      if (!vend.tokenInventario || !safeEq(vend.tokenInventario, d.token)) {
        result = { ok: false, razon: "token_invalido" }; break;
      }
      // Segunda capa: si el vendedor tiene PIN configurado, también se
      // exige — así, aunque el link (con token) se comparta por error,
      // no basta para entrar a ver ventas ni tocar el inventario.
      if (await pinIncorrecto(sb, vend, d.pin, d.vendedor)) {
        result = { ok: false, razon: "pin_requerido", tienePin: true }; break;
      }
      // Validar 30 días desde último corte
      if (corteVencido(vend)) {
        result = { ok: false, razon: "vencido" }; break;
      }
      result = { ok: true, vendedor: vend };
      break;
    }

    case "REGISTRAR_ENTREGA_PENDIENTE": {
      if (!esAdmin) return forbidden();
      const entId = d.id || `ENT_${Date.now()}`;
      // firmaImg se guarda para poder regenerar el mismo PDF del recibo
      // después, desde el Historial — antes no quedaba ningún rastro
      // permanente de la firma ni de los items una vez cerrado el modal.
      await sb.set("entregas", entId, {
        id: entId, vendedor: d.vendedor || "",
        fecha: new Date().toISOString(),
        items: JSON.stringify(d.items || []),
        estado: d.estado || "pendiente",
        codigoRecibo: d.codigoRecibo || "",
        fechaConfirmacion: d.estado === "confirmado" ? new Date().toISOString() : "",
        firmaImg: d.firmaImg || ""
      });
      result = { ok: true };
      break;
    }

    case "GET_ENTREGAS_PENDIENTES": {
      if (!esAdmin) {
        const chkGEP = await validarVendedorToken(sb, d.vendedor, d.token, d.pin);
        if (!chkGEP.ok) { result = { ok: false, error: chkGEP.error }; break; }
      }
      const ents = await sb.query("entregas", "vendedor", "==", d.vendedor);
      result = { ok: true, entregas: ents.filter(e => e.estado === "pendiente") };
      break;
    }

    // Lista TODAS las entregas de un vendedor (confirmadas, pendientes de firma y duplicadas)
    // para la sección "Entregas / Recibos". No manda la firma (pesa) — solo si existe.
    case "GET_ENTREGAS_VENDEDOR": {
      if (!esAdmin) return forbidden();
      if (!d.vendedor) { result = { ok: false, error: "Falta el vendedor" }; break; }
      const entsV = await sb.query("entregas", "vendedor", "==", d.vendedor);
      result = { ok: true, entregas: entsV.map(({ firmaImg, ...e }) => ({ ...e, tieneFirma: !!firmaImg })) };
      break;
    }

    // Una entrega completa (con la firma) para regenerar su recibo PDF.
    case "GET_ENTREGA_RECIBO": {
      if (!esAdmin) return forbidden();
      const entR = await sb.get("entregas", d.id);
      if (!entR) { result = { ok: false, error: "Entrega no encontrada" }; break; }
      result = { ok: true, entrega: entR };
      break;
    }

    case "GET_ENTREGAS_CONFIRMADAS": {
      if (!esAdmin) return forbidden();
      let allEnts;
      try { allEnts = await sb.getAll("entregas"); } catch(_) { allEnts = []; }
      result = { ok: true, entregas: allEnts.filter(e => e.estado === "confirmado") };
      break;
    }

    // Descarta una notificación de entrega confirmada (ej. de una prueba) —
    // solo borra el registro, no toca stock ni consignación.
    case "DESCARTAR_ENTREGA_CONFIRMADA": {
      if (!esAdmin) return forbidden();
      await sb.delete("entregas", d.id);
      result = { ok: true };
      break;
    }

    // Marca una entrega PENDIENTE como duplicada (ej. doble toque al confirmar
    // la entrega: dos avisos de recepción para una sola entrega física).
    // NO borra nada: el registro queda con estado "duplicada" y el vendedor deja
    // de verla (GET_ENTREGAS_PENDIENTES solo devuelve las "pendiente"). No toca
    // stock ni consignación. restaurar:true la devuelve a "pendiente".
    case "MARCAR_ENTREGA_DUPLICADA": {
      if (!esAdmin) return forbidden();
      const entDup = await sb.get("entregas", d.id);
      if (!entDup) { result = { ok: false, error: "Entrega no encontrada" }; break; }
      if (d.restaurar) {
        if (entDup.estado !== "duplicada") { result = { ok: false, error: "Esa entrega no está marcada como duplicada" }; break; }
        await sb.update("entregas", d.id, { estado: "pendiente", fechaDuplicada: null, duplicadaDe: null });
        result = { ok: true, estado: "pendiente" };
        break;
      }
      if (entDup.estado !== "pendiente") { result = { ok: false, error: "Solo se pueden marcar entregas pendientes de confirmar" }; break; }
      await sb.update("entregas", d.id, {
        estado: "duplicada",
        fechaDuplicada: new Date().toISOString(),
        duplicadaDe: d.duplicadaDe ? String(d.duplicadaDe) : null
      });
      result = { ok: true, estado: "duplicada" };
      break;
    }

    case "CONFIRMAR_ENTREGA_RECIBO": {
      const entDoc = await sb.get("entregas", d.id);
      if (!entDoc) { result = { ok: false, error: "Entrega no encontrada" }; break; }
      // Una entrega marcada como duplicada no se puede confirmar (una página
      // abierta desde antes podría intentarlo y la "revivía" como confirmada).
      if (entDoc.estado === "duplicada") { result = { ok: false, error: "Esta entrega fue marcada como duplicada" }; break; }
      if (!esAdmin) {
        const chkCER = await validarVendedorToken(sb, d.vendedor, d.token, d.pin);
        if (!chkCER.ok) { result = { ok: false, error: chkCER.error }; break; }
        if (String(entDoc.vendedor) !== String(d.vendedor)) {
          result = { ok: false, error: "Esta entrega no pertenece a este vendedor" }; break;
        }
      }
      const esperado  = String(entDoc.codigoRecibo || "").toUpperCase();
      const ingresado = String(d.codigoRecibo || "").toUpperCase();
      if (esperado && esperado !== ingresado) {
        result = { ok: false, error: "Código de recibo incorrecto" }; break;
      }
      await sb.update("entregas", d.id, {
        estado: "confirmado", fechaConfirmacion: new Date().toISOString()
      });
      result = { ok: true };
      break;
    }

    case "GET_SOLICITUDES_CORRECCION": {
      if (!esAdmin) return forbidden();
      let sols;
      try { sols = await sb.query("solicitudes_correccion", "estado", "==", "pendiente"); }
      catch(_) { sols = []; }
      result = { ok: true, solicitudes: sols };
      break;
    }

    case "APROBAR_CORRECCION_VENTA": {
      if (!esAdmin) return forbidden();
      const sol = await sb.get("solicitudes_correccion", String(d.id));
      if (!sol) return json({ ok: false, error: "Solicitud no encontrada" });
      // Revertir la venta de verdad — antes solo se marcaba "aprobado" en
      // la solicitud sin tocar el registro de consignación, así que la
      // pieza nunca volvía a aparecer disponible en el inventario del
      // vendedor ni en su catálogo compartido.
      const cantRevertir = parseInt(sol.cantidad) || 1;
      // sol.ventaId ahora es el id del registro INDIVIDUAL de venta
      // (historialVentas del vendedor), no del registro de consignación
      // — hay que buscarlo ahí para saber a qué consignación pertenece.
      const vendSol = sol.vendedor ? await sb.get("vendedores", sol.vendedor) : null;
      const historialSol = vendSol && Array.isArray(vendSol.historialVentas) ? vendSol.historialVentas : [];
      const ventaSol = historialSol.find(v => v.id === sol.ventaId);
      const consignacionIdRevertir = ventaSol?.consignacionId || sol.ventaId; // fallback a solicitudes viejas (pre-historial)
      if (consignacionIdRevertir) {
        const consSol = await sb.get("consignacion", consignacionIdRevertir);
        if (consSol) {
          await sb.update("consignacion", consignacionIdRevertir, {
            vendido: Math.max(0, (parseInt(consSol.vendido)||0) - cantRevertir)
          });
          const sSol = await sb.get("stock", consSol.codigo);
          if (sSol) {
            await sb.update("stock", consSol.codigo, {
              stock_vendido: Math.max(0, (parseInt(sSol.stock_vendido)||0) - cantRevertir)
            });
          }
        }
      }
      if (vendSol && ventaSol) {
        await sb.update("vendedores", sol.vendedor, {
          historialVentas: historialSol.filter(v => v.id !== sol.ventaId)
        });
      }
      await sb.update("solicitudes_correccion", String(d.id), { estado: "aprobado" });
      result = { ok: true };
      break;
    }

    case "RECHAZAR_CORRECCION_VENTA": {
      if (!esAdmin) return forbidden();
      await sb.update("solicitudes_correccion", String(d.id), { estado: "rechazado" });
      result = { ok: true };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
