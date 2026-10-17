// Pedidos de catálogos y afiliados (leads): reserva, confirmación, entrega y cancelación
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { pinIncorrecto } from "../lib/auth.js";
import { fetchResend } from "../lib/avisos.js";
import { _baseTrio } from "../lib/codigos.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { limpiarTextoPublico } from "../lib/publico.js";
import { RE_PAYPAL_ME_LINK, liberarReservaLead, ttlReservaLeadMs } from "../lib/reservas.js";
import { safeEq } from "../lib/seguridad.js";
import { numeroGuardadoPedidoUSA, preciosPermitidosUSA } from "../lib/usa-pedidos.js";

export async function accionesPedidosCatalogo({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    // Lista liviana de vendedores tipo afiliado — usada por el admin (adminverex)
    // para vincular un catálogo temporal a un afiliado real ya registrado.
    case "GET_VENDEDORES_AFILIADOS": {
      if (!esAdmin) return forbidden();
      const vends = await sb.getAll("vendedores");
      result = { ok: true, vendedores: vends.filter(v => v.tipo === "afiliado" && v.activo !== false) };
      break;
    }

    // Público — se llama desde el catálogo temporal cuando el cliente
    // presiona "Quiero este", antes de abrir WhatsApp. Registro silencioso,
    // no requiere sesión de admin ni token del afiliado.
    // Se registra tanto desde catálogos de afiliado (d.afiliado presente)
    // como desde el catálogo público de clientes (d.afiliado vacío) — en
    // ese segundo caso el cliente escribe directo a VEREX por WhatsApp, así
    // que el Lead solo sirve para no perder de vista el interés si la
    // conversación no llega a cerrarse como venta.
    case "REGISTRAR_LEAD": {
      if (!d.codigo) { result = { ok: false, error: "Datos incompletos" }; break; }
      limpiarTextoPublico(d, ["nombre", "nombreCliente", "telefonoCliente", "direccionCliente", "correoCliente", "ciudadUS", "estadoUS", "zipUS", "afiliado"]);
      // Ids y links que el admin usa en botones: formato estricto (si no, se descartan)
      if (d.pedidoId && !/^[A-Za-z0-9_-]{1,60}$/.test(String(d.pedidoId))) d.pedidoId = "";
      if (d.foto && !/^https:\/\/[^\s"'<>`]{1,500}$/.test(String(d.foto))) d.foto = "";
      if (d.pagoLink && !(RE_PAYPAL_ME_LINK.test(d.pagoLink) || /^https:\/\/www\.(sandbox\.)?paypal\.com\/[A-Za-z0-9\/_\-?=&%.]{1,200}$/.test(d.pagoLink) || /^https:\/\/([a-z0-9-]+\.)*wompi\.sv\/[A-Za-z0-9\/_\-?=&%.]{0,300}$/.test(d.pagoLink))) d.pagoLink = "";
      const qtyLead = Math.min(10, Math.max(1, parseInt(d.qty) || 1));
      // Producto de PRUEBA (ver CREAR_PRODUCTO_PRUEBA): solo se puede pedir mientras PayPal esté en Sandbox, y el pedido
      // queda marcado esPrueba para no contar en ingresos. Con cobros reales (live) se rechaza.
      const prodPrueba = await sb.get("stock", d.codigo).catch(() => null);
      const esPruebaLead = !!(prodPrueba && prodPrueba.esPrueba);
      if (esPruebaLead && env.PAYPAL_ENV === "live") { result = { ok: false, error: "producto_de_prueba" }; break; }
      // Pedido USA (se paga en línea): el precio NO se toma del navegador — se verifica contra el inventario,
      // y a un pedido que ya tiene su cobro creado no se le pueden agregar más productos.
      let precioVerificadoUSA = null;
      if (d.pais === "US") {
        if (d.pedidoId) {
          const previos = await sb.query("leads", "pedidoId", "eq", String(d.pedidoId));
          if (previos.some(l => l.pagoCreadoEn)) { result = { ok: false, error: "pedido_cerrado" }; break; }
        }
        // Si no coincide (p. ej. los catálogos de cliente /c con descuento del link, que cobran por PayPal.me y los
        // revisa el admin a mano) el lead se guarda igual pero SIN la marca precioVerificado: así no se puede
        // crear un cobro en línea (CREAR_ORDEN_PAYPAL / CREAR_ENLACE_PAGO_WOMPI) con ese precio.
        if (prodPrueba) {
          const piezaSetLead = d.piezaDeSet === true && !!prodPrueba.set_config;
          const hermanos = prodPrueba.set_config && !piezaSetLead ? (await sb.getAll("stock")).filter(x => _baseTrio(x.codigo || x.id).toUpperCase() === _baseTrio(d.codigo).toUpperCase()) : [];
          const permitidos = preciosPermitidosUSA(prodPrueba, hermanos, d.codigoCab, d.codigoB, piezaSetLead);
          const pedido = Math.round((parseFloat(d.precio) || 0) * 100) / 100;
          precioVerificadoUSA = permitidos.find(p => Math.abs(p - pedido) < 0.011) ?? null;
        }
      }
      // Reserva atómica al momento del pedido (no cuando un admin lo
      // confirma después) — así el catálogo deja de mostrar la pieza
      // como disponible de inmediato, en vez de dejar una ventana donde
      // dos personas pueden pedir la misma última pieza. Si no hay
      // stock, el lead ni se crea.
      let resReservaLead;
      try {
        resReservaLead = await sb.reservar(d.codigo, qtyLead);
      } catch (eReservaLead) {
        result = { ok: false, error: "No se pudo verificar el stock: " + eReservaLead.message };
        break;
      }
      if (!resReservaLead.ok) {
        result = { ok: false, error: "sin_stock", disponible: resReservaLead.disponible || 0 };
        break;
      }
      const leadId = "LEAD_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const numeroUS = d.pais === "US" ? await numeroGuardadoPedidoUSA(sb, d.pedidoId) : "";
      await sb.set("leads", leadId, {
        id: leadId,
        ...(esPruebaLead ? { esPrueba: true } : {}),
        afiliado: d.afiliado || "",
        codigo: d.codigo,
        nombre: d.nombre || "",
        precio: precioVerificadoUSA != null ? precioVerificadoUSA : (parseFloat(d.precio) || 0),
        ...(precioVerificadoUSA != null ? { precioVerificado: true } : {}),
        qty: qtyLead,
        foto: d.foto || "",
        fecha: new Date().toISOString(),
        estado: "interesado",
        // Reserva ya aplicada en stock (ver arriba) — se necesita guardar
        // exactamente de dónde salió para poder reponerla igual si la
        // reserva vence sin confirmarse o el pedido se cancela.
        reservaDescTienda: resReservaLead.desc_tienda || 0,
        reservaDescBodega: resReservaLead.desc_bodega || 0,
        reservaExpiraEn: new Date(Date.now() + ttlReservaLeadMs(d)).toISOString(),
        // Capturados ANTES de que el cliente abra WhatsApp — si el envío
        // falla o nunca lo manda, estos datos son lo único que queda
        // para poder contactarlo. No se guardan en "cliente" (eso sigue
        // reservado para cuando el afiliado completa el pedido de verdad).
        telefonoCliente: d.telefonoCliente || "",
        nombreCliente: d.nombreCliente || "",
        direccionCliente: d.direccionCliente || "",
        correoCliente: d.correoCliente || "",
        // "US" cuando viene de catalogo-us.html — el panel de Logística
        // USA filtra por este campo sin tocar los leads domésticos.
        // pedidoId agrupa varios leads (uno por producto) en un mismo
        // pedido; ciudad/estado/zip/envío/total van repetidos en cada
        // lead del grupo para no tener que armar un join al leerlos.
        pais: d.pais || "",
        pedidoId: d.pedidoId || "",
        ciudadUS: d.ciudadUS || "",
        estadoUS: d.estadoUS || "",
        zipUS: d.zipUS || "",
        envioUSD: d.envioUSD != null ? parseFloat(d.envioUSD) : null,
        totalPedidoUSD: d.totalPedidoUSD != null ? parseFloat(d.totalPedidoUSD) : null,
        // Link de PayPal.me con el monto exacto del pedido, armado en el
        // checkout — el panel de Logística USA lo muestra para copiarlo.
        pagoLink: d.pagoLink || "",
        // Orden del checkout oficial de PayPal (si pagó por ahí) — se usa para capturar y para reconocer su webhook.
        paypalOrderId: /^[A-Z0-9]{8,30}$/.test(d.paypalOrderId || "") ? d.paypalOrderId : "",
        numeroPedidoUSA: numeroUS,
        // Idioma elegido en el catálogo — para poder mandar el correo de
        // pago confirmado en el mismo idioma que el cliente ya venía usando.
        lang: d.lang || "",
        historial: [{ estado: "interesado", fecha: new Date().toISOString() }]
      });

      // ── Notificación por email a VEREX ──────────────────────────
      // Para que un pedido de catálogo no dependa de que alguien esté
      // viendo el badge de Vendedores — llega al correo apenas el
      // cliente toca "¡Hazlo tuyo!" o manda el carrito, indicando
      // siempre si es un cliente directo o de un afiliado (y de cuál).
      // Los pedidos de EE. UU. NO mandan este correo por producto — al
      // terminar el carrito se manda UNO SOLO con el pedido completo
      // (ver ENVIAR_PEDIDO_USA), para no fragmentar en varios correos.
      try {
        const RESEND_KEY = env.RESEND_KEY;
        if (RESEND_KEY && d.pais !== "US") {
          let origenTxt = "👤 Cliente directo (catálogo VEREX)";
          if (d.afiliado) {
            const vend = await sb.get("vendedores", d.afiliado);
            origenTxt = `🎯 Afiliado: ${vend?.nombre || d.afiliado}`;
          }
          await fetchResend("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: "VEREX Store <hola@notificaciones.verexstore.com>",
              reply_to: "hola@verexstore.com",
              to:   ["hola@verexstore.com"],
              subject: `💛 Nuevo interés — ${d.nombre || d.codigo} — $${(parseFloat(d.precio)||0).toFixed(2)}`,
              html: `
                    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                      <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                        <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                        <p style="margin:6px 0 0;font-size:13px;color:#444;">Nuevo interés desde el catálogo</p>
                      </div>
                      <div style="padding:24px;">
                        <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#7a5500;">${origenTxt}</p>
                        <table style="width:100%;border-collapse:collapse;font-size:14px;">
                          <tr><td style="padding:6px 0;color:#888;">Producto</td><td style="font-weight:700;color:#111;">${d.nombre || d.codigo}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Precio</td><td style="color:#111;">$${(parseFloat(d.precio)||0).toFixed(2)}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Cliente</td><td style="color:#111;">${d.nombreCliente || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">WhatsApp</td><td style="color:#111;">${d.telefonoCliente || "—"}</td></tr>
                          <tr><td style="padding:6px 0;color:#888;">Dirección</td><td style="color:#111;">${d.direccionCliente || "—"}</td></tr>
                        </table>
                        <p style="margin:16px 0 0;font-size:12px;color:#999;">Este es un registro de interés capturado antes de que el cliente mande el WhatsApp — revisa la pestaña Vendedores en el Hub para confirmar la venta.</p>
                      </div>
                      <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                        El mundo es mejor cuando brillas tú ✨
                      </div>
                    </div>`
            })
          });
        }
      } catch(leadEmailErr) { console.error("Lead email error:", leadEmailErr); }

      result = { ok: true, leadId, ...(d.pais === "US" ? { precioVerificado: precioVerificadoUSA != null } : {}) };
      break;
    }

    // Portal del afiliado (protegido por token, igual que VERIFICAR_TOKEN)
    case "GET_LEADS_AFILIADO": {
      // Devuelve teléfono/dirección/nombre de clientes de un afiliado —
      // igual de sensible que GET_LEADS_PORTAL_AFILIADO, así que se valida
      // con el mismo tokenPedidos+PIN (antes no pedía nada, solo el código
      // del afiliado, que no es secreto).
      if (!esAdmin) {
        const vendGLA = await sb.get("vendedores", d.vendedor);
        if (!vendGLA || !vendGLA.tokenPedidos || !safeEq(vendGLA.tokenPedidos, d.token)) {
          result = { ok: false, error: "Link inválido" }; break;
        }
        if (await pinIncorrecto(sb, vendGLA, d.pin, d.vendedor)) {
          result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
        }
      }
      const todos = await sb.getAll("leads");
      const propios = todos.filter(l => l.afiliado === d.vendedor);
      result = { ok: true, leads: propios };
      break;
    }

    // El afiliado autorreporta que cerró la venta — NO descuenta stock ni
    // genera comisión todavía, solo avisa al admin para que confirme.
    case "MARCAR_LEAD_VENDIDO": {
      const lead = await sb.get("leads", d.id);
      if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
      if (lead.afiliado !== d.vendedor) { result = { ok: false, error: "No autorizado" }; break; }
      // Mismo token+PIN que GET_LEADS_AFILIADO: antes solo se comparaba
      // el codigo de vendedor (no es secreto), asi que cualquiera que lo
      // conociera podia marcar leads ajenos como vendidos.
      if (!esAdmin) {
        const vendMLV = await sb.get("vendedores", d.vendedor);
        if (!vendMLV || !vendMLV.tokenPedidos || !safeEq(vendMLV.tokenPedidos, d.token)) {
          result = { ok: false, error: "Link inválido" }; break;
        }
        if (await pinIncorrecto(sb, vendMLV, d.pin, d.vendedor)) {
          result = { ok: false, error: "PIN incorrecto", pinRequerido: true }; break;
        }
      }
      const historial = [...(lead.historial || []), { estado: "reportado", fecha: new Date().toISOString() }];
      await sb.update("leads", d.id, { estado: "reportado", historial });
      result = { ok: true };
      break;
    }

    case "GET_LEADS_ADMIN": {
      if (!esAdmin) return forbidden();
      const todos = await sb.getAll("leads");
      result = { ok: true, leads: todos };
      break;
    }

    // El admin confirma un lead reportado — esto SÍ mueve stock y genera
    // la venta real (mismo efecto que REGISTRAR_ENTREGA + REGISTRAR_VENTA).
    // Paso 1 de 2: el admin empaca y entrega el pedido al transportista.
    // La venta NO se cierra todavía — solo se reserva el stock (igual que un
    // pedido de ecommerce) para que no se pueda vender dos veces, mientras el
    // pedido está en camino. La comisión y el conteo de venta final se generan
    // hasta que se confirma la entrega real (ver CONFIRMAR_LEAD_ENTREGA), porque
    // con pago contra entrega el cliente puede rechazar el pedido en la puerta.
    case "CONFIRMAR_LEAD_ENVIO": {
      if (!esAdmin) return forbidden();
      const lead = await sb.get("leads", d.id);
      if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
      if (lead.estado !== "interesado" && lead.estado !== "reportado") {
        result = { ok: false, error: "Este lead no está pendiente de envío" }; break;
      }
      const codigoReal = (d.codigoOverride && String(d.codigoOverride).trim()) || lead.codigo;
      // La reserva normalmente ya se hizo en REGISTRAR_LEAD (al momento del
      // pedido, no aquí). Solo se toca el stock de nuevo si: (a) el admin
      // cambió el producto respecto al pedido original (codigoOverride), lo
      // que implica liberar la reserva vieja y reservar la nueva, o (b) es
      // un lead de antes de este cambio, que nunca llegó a reservar nada.
      let descTienda = lead.reservaDescTienda || 0;
      let descBodega = lead.reservaDescBodega || 0;
      if (codigoReal !== lead.codigo) {
        if (descTienda || descBodega) { try { await sb.liberar(lead.codigo, descTienda, descBodega); } catch (_) {} }
        let resCambio;
        try { resCambio = await sb.reservar(codigoReal, lead.qty || 1); }
        catch (eCambio) { result = { ok: false, error: "No se pudo verificar el stock del nuevo producto: " + eCambio.message }; break; }
        if (!resCambio.ok) {
          if (descTienda || descBodega) { try { await sb.reservar(lead.codigo, lead.qty || 1); } catch (_) {} }
          result = { ok: false, error: "Sin stock disponible para el nuevo producto" }; break;
        }
        descTienda = resCambio.desc_tienda || 0;
        descBodega = resCambio.desc_bodega || 0;
      } else if (!descTienda && !descBodega) {
        let resViejo;
        try { resViejo = await sb.reservar(codigoReal, lead.qty || 1); }
        catch (eViejo) { result = { ok: false, error: "No se pudo verificar el stock: " + eViejo.message }; break; }
        if (!resViejo.ok) { result = { ok: false, error: "Sin stock disponible para confirmar esta venta" }; break; }
        descTienda = resViejo.desc_tienda || 0;
        descBodega = resViejo.desc_bodega || 0;
      }
      const historial = [...(lead.historial || []), { estado: "en_camino", fecha: new Date().toISOString(), codigoConfirmado: codigoReal }];
      await sb.update("leads", d.id, {
        estado: "en_camino", historial, codigoConfirmado: codigoReal,
        reservaDescTienda: descTienda, reservaDescBodega: descBodega,
        reservaExpiraEn: null // confirmado — ya no vence solo
      });
      result = { ok: true };
      break;
    }

    // Paso 2 de 2 (caso A): el transportista SÍ entregó y cobró — recién aquí
    // se cierra la venta de verdad: se libera la reserva hacia vendido, se crea
    // el registro de venta (para comisión e Historial) y se registra el cliente.
    // EXCEPCIÓN: si esCambio=true, este envío es el reemplazo de un cambio de
    // producto ya registrado en OTRO Lead (venta original, ya cobrada) — solo
    // se mueve el stock (la pieza sí salió físicamente), pero NO se crea venta
    // ni comisión nueva, porque el cliente ya pagó una sola vez por esto.
    case "CONFIRMAR_LEAD_ENTREGA": {
      if (!esAdmin) return forbidden();
      const lead = await sb.get("leads", d.id);
      if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
      if (lead.estado !== "en_camino") { result = { ok: false, error: "Este lead no está en camino" }; break; }
      const codigoReal = lead.codigoConfirmado || lead.codigo;
      const s = await sb.get("stock", codigoReal);
      if (!s) { result = { ok: false, error: "El producto (" + codigoReal + ") ya no existe en stock" }; break; }
      const esCambio = Boolean(d.esCambio);
      let consId = null;
      if (!esCambio) {
        const fechaVentaLead = new Date().toISOString();
        consId = "CONS_" + Date.now() + "_" + codigoReal;
        await sb.set("consignacion", consId, {
          id: consId, vendedor: lead.afiliado, codigo: codigoReal,
          nombre: lead.nombre, codigoBase: s.codigoBase || codigoReal,
          talla: s.talla || "", nombre_base: s.nombre_base || lead.nombre,
          categoria: s.categoria || "", precio: lead.precio || s.precio || 0,
          cantidad: 1, vendido: 1,
          foto: lead.foto || s.foto || "", fecha: fechaVentaLead, estado: "activo"
        });
        // Igual que REGISTRAR_VENTA_VENDEDOR/REGISTRAR_VENTA: se guarda un
        // registro individual de la venta con su fecha real — sin esto, las
        // ventas de leads de afiliado nunca aparecían en "Mis Ventas" ni en
        // los Cierres Mensuales (el mismo hueco que le pasó a Jorge Bermúdez).
        const vendLeadHist = await sb.get("vendedores", lead.afiliado);
        if (vendLeadHist) {
          const historialLeadV = Array.isArray(vendLeadHist.historialVentas) ? vendLeadHist.historialVentas : [];
          historialLeadV.push({
            id: `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, consignacionId: consId,
            codigo: codigoReal, nombre: lead.nombre || "",
            precio: lead.precio || s.precio || 0, foto: lead.foto || s.foto || "",
            cantidad: 1, fecha: fechaVentaLead
          });
          await sb.update("vendedores", lead.afiliado, { historialVentas: historialLeadV });
        }
      }
      // Un afiliado SIN piezas físicas nunca tuvo la pieza en sus manos — VEREX
      // la entrega y cobra directo, así que la pieza sale de una vez de reservado
      // hacia vendida, SIN pasar por el balde de "Consignación" (que es para
      // piezas físicamente asignadas a un vendedor).
      // NO sumar a stock_consignacion aquí (aunque sea un afiliado CON
      // stock): el registro de consignación creado arriba ya nace con
      // vendido:1 (cantidad===vendido) — la pieza nunca estuvo "disponible"
      // en consignación, pasó directo de reservada a vendida. Sumarla y
      // nunca restarla es justo lo que generaba los casos "fantasma" que
      // encontró la auditoría de stock.
      await sb.update("stock", codigoReal, {
        stock_reservado:    Math.max(0, (parseInt(s.stock_reservado)||0) - 1),
        stock_vendido:      (parseInt(s.stock_vendido)||0) + 1
      });
      const historial = [...(lead.historial || []), { estado: "vendido", fecha: new Date().toISOString(), codigoConfirmado: codigoReal, esCambio }];
      await sb.update("leads", d.id, { estado: "vendido", historial, consignacionId: consId, esCambio });

      // Registrar/actualizar el cliente en el mismo directorio que usa ecommerce
      // y venta directa (deduplicado por teléfono), para que aparezca en
      // Clientes con su canal — en este caso "Afiliado". No aplica si es cambio
      // (el cliente ya estaba registrado por la venta original).
      if (!esCambio && lead.cliente?.telefono) {
        const clientesAf = await sb.getAll("clientes");
        const normTelAf = t => String(t || "").replace(/\D/g, "");
        const cliExistAf = clientesAf.find(c => normTelAf(c.telefono) === normTelAf(lead.cliente.telefono));
        if (cliExistAf) {
          await sb.update("clientes", cliExistAf.codigo, {
            totalPedidos: (parseInt(cliExistAf.totalPedidos)||0) + 1,
            totalPedidosAfiliado: (parseInt(cliExistAf.totalPedidosAfiliado)||0) + 1,
            ...(cliExistAf.municipio ? {} : { municipio: lead.cliente.municipio || "", departamento: lead.cliente.departamento || "", direccion: lead.cliente.direccion || "" })
          });
        } else {
          const codigoClienteAf = `CVX-${String(clientesAf.length + 1).padStart(3, "0")}`;
          await sb.set("clientes", codigoClienteAf, {
            codigo: codigoClienteAf, nombre: lead.cliente.nombre || "", telefono: lead.cliente.telefono,
            correo: "", municipio: lead.cliente.municipio || "", direccion: lead.cliente.direccion || "", departamento: lead.cliente.departamento || "",
            totalPedidos: 1, totalPedidosEcommerce: 0, totalPedidosDirecta: 0, totalPedidosAfiliado: 1,
            fechaRegistro: new Date().toISOString()
          });
        }
      }

      result = { ok: true };
      break;
    }

    // Paso 2 de 2 (caso B): el cliente rechazó el pedido en la puerta — la
    // pieza regresa a bodega tal cual, sin generar venta ni comisión.
    case "RECHAZAR_LEAD_ENTREGA": {
      if (!esAdmin) return forbidden();
      const lead = await sb.get("leads", d.id);
      if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
      if (lead.estado !== "en_camino") { result = { ok: false, error: "Este lead no está en camino" }; break; }
      const codigoReal = lead.codigoConfirmado || lead.codigo;
      const s = await sb.get("stock", codigoReal);
      if (s) {
        await sb.update("stock", codigoReal, {
          stock_reservado: Math.max(0, (parseInt(s.stock_reservado)||0) - 1),
          stock_bodega:    (parseInt(s.stock_bodega)||0) + 1
        });
      }
      const historial = [...(lead.historial || []), { estado: "rechazado", fecha: new Date().toISOString() }];
      await sb.update("leads", d.id, { estado: "rechazado", historial });
      result = { ok: true };
      break;
    }

    // Cambio de producto DESPUÉS de entregado (talla que no quedó, pieza
    // con defecto, o el motivo que sea) — la venta y la comisión ya
    // quedaron cerradas al confirmar la entrega, así que esto NO las
    // toca: solo ajusta el inventario físico (regresa la pieza vieja a
    // bodega, descuenta la nueva) y deja constancia del cambio.
    case "CAMBIAR_PRODUCTO_LEAD": {
      if (!esAdmin) return forbidden();
      const lead = await sb.get("leads", d.id);
      if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
      if (lead.estado !== "vendido") { result = { ok: false, error: "Solo se puede cambiar un pedido ya entregado" }; break; }
      const codigoNuevo = String(d.codigoNuevo || "").trim();
      if (!codigoNuevo) { result = { ok: false, error: "Falta el código del producto nuevo" }; break; }
      const codigoViejo = lead.codigoConfirmado || lead.codigo;
      const sNuevo = await sb.get("stock", codigoNuevo);
      if (!sNuevo) { result = { ok: false, error: "El producto nuevo (" + codigoNuevo + ") no existe en stock" }; break; }
      const disponibleNuevo = (parseInt(sNuevo.stock_bodega)||0) + (parseInt(sNuevo.stock_tienda)||0);
      if (disponibleNuevo < 1) { result = { ok: false, error: "Sin stock disponible del producto nuevo" }; break; }

      const sViejo = await sb.get("stock", codigoViejo);
      if (sViejo) {
        await sb.update("stock", codigoViejo, { stock_bodega: (parseInt(sViejo.stock_bodega)||0) + 1 });
      }
      const restaBodega = Math.min(1, parseInt(sNuevo.stock_bodega)||0);
      await sb.update("stock", codigoNuevo, {
        stock_bodega: Math.max(0, (parseInt(sNuevo.stock_bodega)||0) - restaBodega),
        stock_tienda: Math.max(0, (parseInt(sNuevo.stock_tienda)||0) - (1 - restaBodega))
      });

      if (lead.consignacionId) {
        const nombreViejo = lead.nombre || codigoViejo;
        const fechaCambio = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
        const notaCambio = `🔄 Cambio de producto el ${fechaCambio}: "${nombreViejo}" (${codigoViejo}) → "${sNuevo.nombre_base || sNuevo.nombre || codigoNuevo}" (${codigoNuevo})${d.motivo ? " — Motivo: " + d.motivo : ""}`;
        await sb.update("consignacion", lead.consignacionId, {
          codigo: codigoNuevo, codigoBase: sNuevo.codigoBase || codigoNuevo,
          talla: sNuevo.talla || "", nombre: sNuevo.nombre_base || sNuevo.nombre || lead.nombre,
          nombre_base: sNuevo.nombre_base || sNuevo.nombre || lead.nombre,
          foto: sNuevo.foto || lead.foto || "",
          notaCambio
        });
      }

      const historialCambio = [...(lead.historial || []), {
        estado: "cambio", fecha: new Date().toISOString(),
        codigoAnterior: codigoViejo, codigoNuevo, motivo: d.motivo || ""
      }];
      await sb.update("leads", d.id, {
        codigo: codigoNuevo, codigoConfirmado: codigoNuevo,
        nombre: sNuevo.nombre_base || sNuevo.nombre || lead.nombre,
        foto: sNuevo.foto || lead.foto || "",
        historial: historialCambio
      });
      result = { ok: true };
      break;
    }

    case "CANCELAR_LEAD": {
      if (!esAdmin) return forbidden();
      const lead = await sb.get("leads", d.id);
      if (!lead) { result = { ok: false, error: "Lead no encontrado" }; break; }
      // Si el pedido tenía una reserva activa (no se había vendido ni
      // entregado todavía), se repone al cancelar — si no, la pieza queda
      // atascada en stock_reservado para siempre, sin poder venderse.
      const yaVendido = lead.estado === "vendido" || lead.entregadoUSA;
      if (!yaVendido) {
        try { await liberarReservaLead(sb, lead); }
        catch (eCancela) { console.error("Error liberando reserva al cancelar lead " + d.id, eCancela); }
      }
      const motivoCancela = typeof d.motivo === "string" ? d.motivo.slice(0, 60) : "";
      const historial = [...(lead.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), ...(motivoCancela ? { motivo: motivoCancela } : {}) }];
      await sb.update("leads", d.id, {
        estado: "cancelado", historial,
        // "Registrar venta" cancela el pedido para liberar la pieza (la venta directa la descuenta de nuevo);
        // si la venta nunca se guarda, queda marcado para poder restaurarlo (ver CERRAR_LEAD_VD).
        ...(d.pendienteVD === true ? { pendienteVD: true } : {}),
        reservaExpiraEn: null, reservaDescTienda: 0, reservaDescBodega: 0
      });
      result = { ok: true };
      break;
    }

    // La venta directa que salió de un pedido de catálogo ya se registró: el pedido deja de ser restaurable.
    case "CERRAR_LEAD_VD": {
      if (!esAdmin) return forbidden();
      const leadCv = await sb.get("leads", d.id);
      if (!leadCv) { result = { ok: false, error: "Lead no encontrado" }; break; }
      if (leadCv.pendienteVD) {
        await sb.update("leads", d.id, {
          pendienteVD: false,
          historial: [...(leadCv.historial || []), { estado: "cancelado", fecha: new Date().toISOString(), motivo: "Venta directa registrada" }]
        });
      }
      result = { ok: true };
      break;
    }

    // Restaura pedidos que el sistema canceló solo por reserva vencida ("Reserva vencida sin confirmar"):
    // vuelve a reservar la pieza y los deja "interesado". Todo o nada: si falta stock en alguna pieza, no restaura ninguna.
    case "RESTAURAR_LEAD_VENCIDO": {
      if (!esAdmin) return forbidden();
      const idsR = Array.isArray(d.ids) ? [...new Set(d.ids.map(String))].slice(0, 20) : [];
      if (!idsR.length) { result = { ok: false, error: "Faltan los pedidos a restaurar" }; break; }
      const lsR = [];
      for (const idR of idsR) {
        const lR = await sb.get("leads", idR);
        const ultR = lR && (lR.historial || [])[(lR.historial || []).length - 1];
        const restaurable = ultR && (ultR.motivo === "Reserva vencida sin confirmar" || (lR && lR.pendienteVD === true && ultR.motivo === "Pasado a venta directa"));
        if (!lR || lR.estado !== "cancelado" || !restaurable || lR.pagadoUSA) {
          result = { ok: false, error: "no_restaurable", id: idR }; break;
        }
        lsR.push(lR);
      }
      if (result) break;
      const hechasR = [];
      let falloR = null;
      for (const lR of lsR) {
        let rv;
        try { rv = await sb.reservar(lR.codigo, parseInt(lR.qty) || 1); } catch (eR) { rv = { ok: false, error: String(eR.message || eR) }; }
        if (!rv.ok) { falloR = { codigo: lR.codigo, nombre: lR.nombre || lR.codigo, disponible: rv.disponible || 0 }; break; }
        hechasR.push({ lead: lR, rv });
      }
      if (falloR) {
        for (const h of hechasR) { try { await sb.liberar(h.lead.codigo, h.rv.desc_tienda || 0, h.rv.desc_bodega || 0); } catch (_) {} }
        result = { ok: false, error: "sin_stock", ...falloR };
        break;
      }
      const ahoraR = new Date().toISOString();
      for (const { lead, rv } of hechasR) {
        await sb.update("leads", lead.id, {
          estado: "interesado", vencidoEn: null, pendienteVD: false,
          reservaDescTienda: rv.desc_tienda || 0, reservaDescBodega: rv.desc_bodega || 0,
          reservaExpiraEn: new Date(Date.now() + ttlReservaLeadMs(lead)).toISOString(),
          historial: [...(lead.historial || []), { estado: "interesado", fecha: ahoraR, motivo: "Restaurado por el admin" }]
        });
      }
      result = { ok: true, restaurados: hechasR.length };
      break;
    }

    // Producto de PRUEBA con su propio stock (no toca el inventario real). Se crea/reinicia con esta acción y se pide
    // en el catálogo con ?prueba=1. Nunca pisa un producto real (si el código ya existe y no es de prueba, se rechaza).
    case "CREAR_PRODUCTO_PRUEBA": {
      if (!esAdmin) return forbidden();
      if (env.PAYPAL_ENV === "live") { result = { ok: false, error: "solo_en_sandbox" }; break; }
      const codP = String(d.codigo || "W78RE").trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,20}$/.test(codP)) { result = { ok: false, error: "codigo_invalido" }; break; }
      const existeP = await sb.get("stock", codP);
      if (existeP && !existeP.esPrueba) { result = { ok: false, error: "codigo_en_uso_por_producto_real" }; break; }
      const cantP = Math.min(500, Math.max(1, parseInt(d.cantidad) || 50));
      await sb.set("stock", codP, {
        ...(existeP || {}),
        codigo: codP, nombre: "PRUEBA - no es un producto real", nombre_base: "PRUEBA - no es un producto real",
        categoria: "CO", precio: Math.round((parseFloat(d.precio) || 50) * 100) / 100,
        esPrueba: true, enCatalogo: true, estado: "bodega", fechaRegistro: existeP?.fechaRegistro || new Date().toISOString(),
        stock_bodega: cantP, stock_tienda: 0, stock_consignacion: 0, stock_reservado: 0, stock_vendido: 0, stock_total: cantP,
      });
      result = { ok: true, codigo: codP, cantidad: cantP };
      break;
    }

    // Borra TODOS los pedidos de prueba (leads esPrueba, en cualquier estado) y deja el producto de prueba con su stock inicial.
    // No toca ningún producto real. Solo en Sandbox.
    case "LIMPIAR_PEDIDOS_PRUEBA": {
      if (!esAdmin) return forbidden();
      if (env.PAYPAL_ENV === "live") { result = { ok: false, error: "solo_en_sandbox" }; break; }
      const leadsP = (await sb.getAll("leads")).filter(l => l.esPrueba === true);
      for (const l of leadsP) await sb.delete("leads", l.id);
      const prodsP = (await sb.getAll("stock")).filter(x => x.esPrueba === true);
      for (const x of prodsP) {
        const base = Math.max(1, parseInt(x.stock_total) || 50);
        await sb.update("stock", x.codigo, { stock_bodega: base, stock_reservado: 0, stock_vendido: 0, stock_tienda: 0, stock_consignacion: 0 });
      }
      result = { ok: true, pedidosBorrados: new Set(leadsP.map(l => l.pedidoId || l.id)).size, productosReiniciados: prodsP.length };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
