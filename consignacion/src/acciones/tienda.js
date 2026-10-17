// Tienda online (verexstore.com): catálogo público, pedidos, clientes y cupones
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { fetchResend } from "../lib/avisos.js";
import { _baseTrio, piezasExtraSet } from "../lib/codigos.js";
import { cuponNoUsable, cuponPublico, envioSV, idClienteCupon } from "../lib/cupones.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { limpiarTextoPublico, sanearConfigPublico } from "../lib/publico.js";
import { liberarStockPedido } from "../lib/reservas.js";
import { _r2, descuentoCuponUSA, preciosPermitidosUSA } from "../lib/usa-pedidos.js";

export async function accionesTienda({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "GUARDAR_PEDIDO": {
      if (!esAdmin) return forbidden();   // antes cualquiera podía sobrescribir cualquier pedido
      const pedidoId = d.numeroPedido || `PED_${Date.now()}`;
      await sb.set("pedidos", pedidoId, { ...d, id: pedidoId });
      result = { ok: true, numeroPedido: pedidoId };
      break;
    }

    case "GET_PEDIDOS": {
      if (!esAdmin) return forbidden();
      const pedidos = await sb.getAll("pedidos");
      result = { ok: true, pedidos };
      break;
    }

    case "ACTUALIZAR_ESTADO_PEDIDO": {
      if (!esAdmin) return forbidden();

      // Cargar pedido actual para verificar si ya se actualizó el stock
      const pedidoActual = await sb.get("pedidos", d.numeroPedido);
      if (!pedidoActual) { result = { ok: false, error: "Pedido no encontrado" }; break; }

      // Guardar nuevo estado
      await sb.update("pedidos", d.numeroPedido, { estado: d.estado });

      // ── Ajustar stock según nuevo estado ──────────────────────
      let itemsEst = [];
      try {
        itemsEst = typeof pedidoActual.items === "string"
          ? JSON.parse(pedidoActual.items) : (pedidoActual.items || []);
      } catch(_) {}

      if (d.estado === "Entregado" && !pedidoActual.stockActualizado) {
        // Reservado → Vendido (incluye caballero / pieza B de un set, solo si se apartaron al crear el pedido)
        const extrasApartados = (Array.isArray(pedidoActual.reservas) ? pedidoActual.reservas : []).filter(r => r && r.piezaDe && r.codigo);
        itemsEst = [...itemsEst, ...extrasApartados.map(r => ({ codigo: r.codigo, cantidad: 1 }))];
        for (const item of itemsEst) {
          if (!item.codigo) continue;
          const prod = await sb.get("stock", item.codigo);
          if (!prod) continue;
          const qty = parseInt(item.cantidad || 1);
          const upd = {
            stock_reservado: Math.max(0, (parseInt(prod.stock_reservado)||0) - qty),
            stock_vendido:   (parseInt(prod.stock_vendido)||0) + qty,
          };
          // Talla específica para anillos
          const talla = item.tallaElegida;
          if (talla && talla !== "—" && prod.caracteristicas) {
            try {
              const chars = typeof prod.caracteristicas === "string"
                ? JSON.parse(prod.caracteristicas) : prod.caracteristicas;
              if (chars[talla] !== undefined) {
                chars[talla] = Math.max(0, (parseInt(chars[talla])||0) - qty);
                upd.caracteristicas = JSON.stringify(chars);
              }
            } catch(_) {}
          }
          await sb.update("stock", item.codigo, upd);
        }
        await sb.update("pedidos", d.numeroPedido, { stockActualizado: true });

      } else if ((d.estado === "Cancelado" || d.estado === "No entregado") && !pedidoActual.stockLiberado) {
        // Reservado → regresa a stock (ver liberarStockPedido)
        await liberarStockPedido(sb, { ...pedidoActual, numeroPedido: d.numeroPedido });
      }

      // ── Notificar al cliente si fue Despachado, ordenó por correo y tiene correo ──
      if (d.estado === "Despachado" && pedidoActual.canal === "correo" && pedidoActual.correo) {
        try {
          const RESEND_KEY = env.RESEND_KEY;
          if (RESEND_KEY) {
            await fetchResend("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: "VEREX Store <hola@notificaciones.verexstore.com>",
                reply_to: "hola@verexstore.com",
                to:   [pedidoActual.correo],
                subject: `🚚 Tu pedido ${pedidoActual.numeroPedido} está en camino — VEREX Store`,
                html: `
                      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                        <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                          <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                          <p style="margin:6px 0 0;font-size:13px;color:#444;">🚚 Tu pedido está en camino</p>
                        </div>
                        <div style="padding:24px;">
                          <p style="margin:0 0 16px;font-size:15px;color:#111;">¡Hola, <strong>${pedidoActual.cliente}</strong>! 💛</p>
                          <p style="margin:0 0 16px;font-size:14px;color:#333;">¡Tenemos excelentes noticias! Tu pedido <strong>${pedidoActual.numeroPedido}</strong> ha sido despachado y ya está en camino hacia ti.</p>
                          <h2 style="color:#C9A84C;margin:0 0 16px;">${pedidoActual.numeroPedido}</h2>
                          <table style="width:100%;border-collapse:collapse;font-size:14px;">
                            <tr><td style="padding:6px 0;color:#555;">Productos</td><td style="font-weight:700;color:#111;">${pedidoActual.productos || "—"}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;">Destino</td><td style="color:#111;">${pedidoActual.departamento || ""} ${pedidoActual.municipio || ""}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;font-weight:700;">Total</td><td style="font-size:18px;font-weight:800;color:#C9A84C;">${pedidoActual.total}</td></tr>
                          </table>
                          <div style="margin:20px 0 0;padding:14px 16px;background:#b0b0b0;border-left:4px solid #C9A84C;border-radius:6px;font-size:13px;color:#333;">
                            🕐 <strong>Tiempos estimados de entrega:</strong><br><br>
                            Para el <strong>área metropolitana de San Salvador</strong>, tu pedido llegará en un máximo de <strong>24 horas</strong> a partir del despacho.<br><br>
                            Para el <strong>resto del país</strong>, el tiempo estimado es de máximo <strong>48 horas</strong>.
                          </div>
                          <p style="margin:16px 0 0;font-size:13px;color:#444;">Si tienes alguna consulta no dudes en escribirnos a <a href="mailto:hola@verexstore.com" style="color:#7a5500;">hola@verexstore.com</a></p>
                        </div>
                        <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                          El mundo es mejor cuando brillas tú ✨ — <a href="https://verexstore.com" style="color:#C9A84C;text-decoration:none;">verexstore.com</a>
                        </div>
                      </div>`
              })
            });
          }
        } catch(dispatchEmailErr) { console.error("Dispatch email error:", dispatchEmailErr); }
      }

      result = { ok: true };
      break;
    }

    case "GET_CLIENTES": {
      if (!esAdmin) return forbidden();
      const clientes = await sb.getAll("clientes");
      result = { ok: true, clientes };
      break;
    }

    case "GUARDAR_CLIENTE": {
      if (!esAdmin) return forbidden();
      await sb.set("clientes", d.codigo || `CLI_${Date.now()}`, d);
      result = { ok: true };
      break;
    }

    // Revisa (sin gastarlo) si un cupón se puede usar: activo, sin vencer, con usos y — si es de un uso por
    // cliente — que ese cliente (correo o teléfono) no lo haya usado ya. Las tiendas lo llaman antes de cobrar.
    case "VALIDAR_CUPON": {
      const codV = String(d.codigo || "").trim().toUpperCase().slice(0, 40);
      const cupV = codV ? await sb.get("cupones", codV) : null;
      result = cuponNoUsable(cupV, d.cliente, d.tienda) || { ok: true, cupon: cuponPublico(cupV) };
      break;
    }

    case "USAR_CUPON": {
      // Antes era pública: cualquiera podía agotar un cupón con límite de usos llamándola en bucle. Ahora el cupón lo
      // gasta el servidor al crear el pedido (NUEVO_PEDIDO) o el cobro USA; esta acción queda solo para el admin.
      if (!esAdmin) { result = { ok: true, ignorado: true }; break; }
      const cup = await sb.get("cupones", d.codigo);
      const errUso = cuponNoUsable(cup, d.cliente, d.tienda);
      if (errUso) { result = errUso; break; }
      const usosActuales = (parseInt(cup.usosActuales) || 0);
      const limiteUsos   = parseInt(cup.limiteUsos) || 0;
      const patchCup = {
        usosActuales: usosActuales + 1,
        // Desactivar automáticamente si llegó al límite
        activo: limiteUsos > 0 ? (usosActuales + 1 < limiteUsos) : true
      };
      const idCli = idClienteCupon(d.cliente);
      if (cup.unoPorCliente && idCli) patchCup.usadoPor = [...(Array.isArray(cup.usadoPor) ? cup.usadoPor : []), idCli].slice(-5000);
      await sb.update("cupones", d.codigo, patchCup);
      result = { ok: true };
      break;
    }

    case "GET_CATALOGO": {
      const [prods, cups, cfgDoc] = await Promise.all([
        sb.getAll("stock"),
        sb.getAll("cupones"),
        sb.get("config", "settings"),
      ]);
      const cfg2   = cfgDoc || {};
      const limite = parseInt(cfg2.limiteCatalogo) || 0; // 0 = sin límite

      let activos = prods.filter(p =>
        (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") &&
        p.estado !== "inactivo" &&
        (!p.esPrueba || (d.incluirPrueba === true && env.PAYPAL_ENV !== "live"))   // el producto de prueba solo se ve con ?prueba=1 y en Sandbox
      );

      // Separar destacados del resto
      const destacados = activos.filter(p => p.destacado === true || p.destacado === "TRUE" || p.destacado === "true");
      const normales   = activos.filter(p => !(p.destacado === true || p.destacado === "TRUE" || p.destacado === "true"));

      // Rotación semanal: semilla basada en número de semana del año
      const ahora     = new Date();
      const inicioAno = new Date(ahora.getFullYear(), 0, 1);
      const semana    = Math.floor((ahora - inicioAno) / (7 * 24 * 60 * 60 * 1000));
      // Shuffle determinístico con semilla semanal
      const shuffled = normales.slice().sort((a, b) => {
        const ha = parseInt(String(semana) + String((a.codigo||"").charCodeAt(0)||0), 10) % 997;
        const hb = parseInt(String(semana) + String((b.codigo||"").charCodeAt(0)||0), 10) % 997;
        return ha - hb;
      });

      // Destacados primero, luego rotados
      let final = [...destacados, ...shuffled];

      // Aplicar límite si está configurado
      if (limite > 0) final = final.slice(0, limite);

      result = {
        ok:        true,
        // `ocasiones` son etiquetas internas del admin (Catálogo Cliente) y `costo` es lo que te costó la pieza
        // (Rentabilidad de Logística USA) — ninguno de los dos se publica en la tienda.
        productos: final.map(({ ocasiones, costo, ...p }) => p),
        // usadoPor = correos/teléfonos de quienes ya usaron un cupón de un uso por cliente: nunca se publica.
        // Los códigos de cupón ya no se publican: la tienda los valida uno por uno con VALIDAR_CUPON.
        cupones:   [],
        config:    sanearConfigPublico(cfg2)
      };
      break;
    }

    case "NUEVO_PEDIDO": {
      // Público (tienda y catálogos): lo que escribe el cliente se guarda y se manda por correo como texto, nunca HTML.
      limpiarTextoPublico(d, ["cliente", "telefono", "telLlamada", "municipio", "departamento", "direccion", "correo", "productos", "metodoPago", "cuponUsado"]);
      // Reservar stock ANTES de crear el pedido — de forma atómica (ver
      // reservar_stock_pedido en Supabase), para que dos pedidos por
      // WhatsApp casi simultáneos del mismo producto no puedan vender la
      // misma pieza dos veces. Si algún producto ya no alcanza, el
      // pedido ni se crea, y lo que sí se alcanzó a reservar de items
      // anteriores se libera (todo o nada).
      let itemsPedNuevo = [];
      try { itemsPedNuevo = typeof d.items === "string" ? JSON.parse(d.items) : (d.items || []); } catch(_) {}
      const reservasPed = [];
      let faltantePed = null;
      for (const item of itemsPedNuevo) {
        if (!item.codigo) continue;
        const qtyPed = Math.min(10, Math.max(1, parseInt(item.cantidad) || 1));
        let resReservaPed;
        try { resReservaPed = await sb.reservar(item.codigo, qtyPed); }
        catch (eResPed) { faltantePed = { codigo: item.codigo, error: eResPed.message }; break; }
        if (!resReservaPed.ok) { faltantePed = { codigo: item.codigo, error: resReservaPed.error }; break; }
        reservasPed.push({ codigo: item.codigo, descTienda: resReservaPed.desc_tienda || 0, descBodega: resReservaPed.desc_bodega || 0 });
        // Set de anillos: el caballero y la 2da pieza de dama (B) también salen del stock (1 de cada una).
        for (const extra of (item.set_config ? piezasExtraSet(item) : [])) {
          let resExtra;
          try { resExtra = await sb.reservar(extra, 1); }
          catch (eResEx) { faltantePed = { codigo: extra, error: eResEx.message }; break; }
          if (!resExtra.ok) { faltantePed = { codigo: extra, error: resExtra.error }; break; }
          reservasPed.push({ codigo: extra, descTienda: resExtra.desc_tienda || 0, descBodega: resExtra.desc_bodega || 0, piezaDe: item.codigo });
        }
        if (faltantePed) break;
      }
      if (faltantePed) {
        for (const r of reservasPed) { try { await sb.liberar(r.codigo, r.descTienda, r.descBodega); } catch (_) {} }
        result = { ok: false, error: "sin_stock", codigo: faltantePed.codigo };
        break;
      }

      // Total verificado en el servidor (precios del inventario + cupón + reglas de envío). Estos pedidos se pagan
      // contra entrega y el admin los confirma, así que no se rechazan: si el total del navegador no coincide, el
      // pedido queda con un aviso para revisarlo. El cupón se gasta AQUÍ (antes lo gastaba el navegador).
      let alertaTotal = null, totalEsperadoSV = null;
      try {
        const codsSV = itemsPedNuevo.filter(i => i && i.codigo).map(i => String(i.codigo));
        const filasSV = new Map((await sb.getMany("stock", codsSV)).map(x => [String(x.id), x]));
        const hayRings = [...filasSV.values()].some(x => x.set_config);
        const todoStock = hayRings ? await sb.getAll("stock") : [];
        let precioMal = false;
        const lineasSV = itemsPedNuevo.filter(i => i && i.codigo).map(i => {
          const row = filasSV.get(String(i.codigo));
          const pCli = Math.round((parseFloat(i.precioNum ?? i.precio) || 0) * 100) / 100;
          if (!row) { precioMal = true; return { codigo: i.codigo, precio: pCli, qty: 1 }; }
          const herm = row.set_config ? todoStock.filter(x => _baseTrio(x.codigo || x.id).toUpperCase() === _baseTrio(i.codigo).toUpperCase()) : [];
          const perm = preciosPermitidosUSA(row, herm, i.codigoCab, i.codigoB);
          const ok = perm.find(p => Math.abs(p - pCli) < 0.011);
          if (ok == null) precioMal = true;
          return { codigo: i.codigo, precio: ok ?? perm[0], qty: Math.min(10, Math.max(1, parseInt(i.cantidad) || 1)) };
        });
        const subSV = _r2(lineasSV.reduce((a, l) => a + l.precio * l.qty, 0));
        let cupSV = null, motivoCup = "";
        if (d.cuponUsado) {
          const c = await sb.get("cupones", String(d.cuponUsado).toUpperCase());
          const err = cuponNoUsable(c, d.telefono, "sv");
          if (err) motivoCup = err.motivo; else cupSV = c;
        }
        const descSV = descuentoCuponUSA(cupSV, lineasSV, subSV);
        const cfgSV = await sb.get("config", "settings");
        let envSV = envioSV(cfgSV, subSV);
        const cupEnvioOk = cupSV && cupSV.tipo === "envio_gratis" && !((parseFloat(cupSV.montoMinimo) || 0) > subSV);
        if (cupEnvioOk) envSV = 0;
        totalEsperadoSV = _r2(subSV - descSV + envSV);
        const totalCli = parseFloat(String(d.total || "").replace(/[^0-9.]/g, "")) || 0;
        if (precioMal || motivoCup || Math.abs(totalEsperadoSV - totalCli) > 0.011) {
          alertaTotal = { esperado: totalEsperadoSV, recibido: totalCli, precioDistinto: precioMal, cupon: motivoCup || "" };
        }
        if (cupSV && (descSV > 0 || cupEnvioOk)) {
          const usos = (parseInt(cupSV.usosActuales) || 0) + 1, lim = parseInt(cupSV.limiteUsos) || 0;
          const patchC = { usosActuales: usos, activo: lim > 0 ? usos < lim : true };
          const idC = idClienteCupon(d.telefono);
          if (cupSV.unoPorCliente && idC) patchC.usadoPor = [...(Array.isArray(cupSV.usadoPor) ? cupSV.usadoPor : []), idC].slice(-5000);
          await sb.update("cupones", cupSV.codigo, patchC);
        }
      } catch (eTot) { console.error("NUEVO_PEDIDO verificar total:", eTot); }

      const now      = new Date();
      const dd       = String(now.getDate()).padStart(2, "0");
      const mm       = String(now.getMonth() + 1).padStart(2, "0");
      const prefijo  = `#10${dd}${mm}`;
      const todosLosPedidos = await sb.getAll("pedidos");
      const hoyStr   = now.toISOString().slice(0, 10);
      const correl   = todosLosPedidos.filter(p => (p.fecha || "").slice(0, 10) === hoyStr).length + 1;
      const numeroPedido = `${prefijo}-${String(correl).padStart(3, "0")}`;
      const clientes = await sb.getAll("clientes");
      const normTelPed = t => String(t || "").replace(/\D/g, "");
      const cliExist = clientes.find(c => normTelPed(c.telefono) === normTelPed(d.telefono));
      let codigoCliente = "";
      if (cliExist) {
        codigoCliente = cliExist.codigo;
        const updCli = {
          totalPedidos: (parseInt(cliExist.totalPedidos)||0) + 1,
          totalPedidosEcommerce: (parseInt(cliExist.totalPedidosEcommerce)||0) + 1
        };
        if (d.correo && !cliExist.correo) updCli.correo = d.correo;
        await sb.update("clientes", codigoCliente, updCli);
      } else {
        codigoCliente = `CVX-${String(clientes.length + 1).padStart(3, "0")}`;
        await sb.set("clientes", codigoCliente, {
          codigo: codigoCliente, nombre: d.cliente, telefono: d.telefono,
          correo: d.correo || "",
          municipio: d.municipio || "", direccion: d.direccion || "",
          departamento: d.departamento || "", totalPedidos: 1,
          totalPedidosEcommerce: 1, totalPedidosDirecta: 0,
          fechaRegistro: new Date().toISOString()
        });
      }
      await sb.set("pedidos", numeroPedido, {
        id: numeroPedido, numeroPedido, fecha: new Date().toISOString(),
        cliente: d.cliente, telefono: d.telefono, municipio: d.municipio || "",
        departamento: d.departamento || "", direccion: d.direccion || "",
        correo: d.correo || "", telLlamada: d.telLlamada || "",
        productos: d.productos || "", total: d.total || 0,
        estado: "Pendiente", metodoPago: d.metodoPago || "",
        items: d.items || "", cuponUsado: d.cuponUsado || "",
        descMonto: d.descMonto || 0, envio: d.envio || 0,
        codigoCliente: codigoCliente || "", canal: d.canal || "whatsapp",
        // De dónde salió exactamente cada unidad reservada arriba —
        // necesario para poder reponerla al lugar correcto si el pedido
        // se cancela (ver ACTUALIZAR_ESTADO_PEDIDO).
        reservas: reservasPed,
        ...(totalEsperadoSV != null ? { totalVerificado: totalEsperadoSV } : {}),
        ...(alertaTotal ? { alertaTotal } : {})
      });

      // ── Notificación por email ─────────────────────────────────
      try {
        const RESEND_KEY = env.RESEND_KEY;
        if (!RESEND_KEY) throw new Error("RESEND_KEY no configurada en Cloudflare Secrets");
        await fetchResend("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: "VEREX Store <hola@notificaciones.verexstore.com>",
            reply_to: "hola@verexstore.com",
            to:   ["hola@verexstore.com"],
            subject: `${alertaTotal ? "⚠️ REVISAR TOTAL — " : ""}🛍️ Nuevo Pedido ${numeroPedido} — ${d.total}${alertaTotal ? ` (debería ser $${alertaTotal.esperado.toFixed(2)})` : ""}`,
            html: `
                  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                      <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                      <p style="margin:6px 0 0;font-size:13px;color:#444;">Nuevo pedido recibido</p>
                    </div>
                    <div style="padding:24px;">
                      <h2 style="color:#C9A84C;margin:0 0 16px;">${numeroPedido}</h2>
                      <table style="width:100%;border-collapse:collapse;font-size:14px;">
                        <tr><td style="padding:6px 0;color:#888;">Cliente</td><td style="font-weight:700;color:#111;">${d.cliente}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Teléfono</td><td style="color:#111;">${d.telefono}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Ubicación</td><td style="color:#111;">${d.departamento || ""} ${d.municipio || ""}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Dirección</td><td style="color:#111;">${d.direccion || "—"}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Productos</td><td style="color:#111;">${d.productos || "—"}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;">Pago</td><td style="color:#111;">${d.metodoPago || "—"}</td></tr>
                        <tr><td style="padding:6px 0;color:#888;font-weight:700;">Total</td><td style="font-size:18px;font-weight:800;color:#C9A84C;">${d.total}</td></tr>
                      </table>
                    </div>
                    <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                      El mundo es mejor cuando brillas tú ✨
                    </div>
                  </div>`
          })
        });
      } catch(emailErr) { console.error("Email error:", emailErr); }

      // ── Confirmación al cliente (solo si dejó correo) ──────────
      if (d.correo) {
        try {
          const RESEND_KEY = env.RESEND_KEY;
          if (RESEND_KEY) {
            await fetchResend("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: "VEREX Store <hola@notificaciones.verexstore.com>",
                reply_to: "hola@verexstore.com",
                to:   [d.correo],
                subject: `✅ Confirmación de tu pedido ${numeroPedido} — VEREX Store — ${d.total}`,
                html: `
                      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;border:2px solid #C9A84C;border-radius:12px;overflow:hidden;">
                        <div style="background:linear-gradient(135deg,#aaa,#d0d0d0);padding:24px;text-align:center;">
                          <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#111;">VEREX STORE</h1>
                          <p style="margin:6px 0 0;font-size:13px;color:#444;">Confirmación de pedido</p>
                        </div>
                        <div style="padding:24px;">
                          <p style="margin:0 0 16px;font-size:15px;color:#111;">Hola <strong>${d.cliente}</strong>, ¡gracias por tu compra! 💛</p>
                          <p style="margin:0 0 16px;font-size:14px;color:#444;">Tu pedido ha sido recibido y está siendo procesado.</p>
                          <h2 style="color:#C9A84C;margin:0 0 16px;">${numeroPedido}</h2>
                          <table style="width:100%;border-collapse:collapse;font-size:14px;">
                            <tr><td style="padding:6px 0;color:#555;">Productos</td><td style="font-weight:700;color:#111;">${d.productos || "—"}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;">Pago</td><td style="color:#111;">${d.metodoPago || "—"}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;">Envío a</td><td style="color:#111;">${d.departamento || ""} ${d.municipio || ""}</td></tr>
                            <tr><td style="padding:6px 0;color:#555;font-weight:700;">Total</td><td style="font-size:18px;font-weight:800;color:#C9A84C;">${d.total}</td></tr>
                          </table>
                          <p style="margin:20px 0 0;font-size:13px;color:#444;">Nos pondremos en contacto contigo pronto para coordinar la entrega.</p>
                        </div>
                        <div style="padding:16px 24px;background:#f5f5f5;border-top:2px solid #C9A84C;text-align:center;font-size:12px;color:#888;">
                          El mundo es mejor cuando tú brillas ✨ — <a href="https://verexstore.com" style="color:#C9A84C;text-decoration:none;">verexstore.com</a>
                        </div>
                      </div>`
              })
            });
          }
        } catch(clientEmailErr) { console.error("Client email error:", clientEmailErr); }
      }

      result = { ok: true, numeroPedido, codigoCliente };
      break;
    }

    // Datos personales de un cliente (por código CVX-### o teléfono): solo admin. Los códigos son
    // consecutivos, así que siendo pública cualquiera podía recorrer CVX-001, CVX-002… y bajar nombre,
    // teléfono, dirección y correo de todos. El autocompletado del catálogo que la usaba ya no se muestra.
    case "BUSCAR_CLIENTE": {
      if (!esAdmin) return forbidden();
      const cliAll = await sb.getAll("clientes");
      const cli = cliAll.find(c =>
        String(c.codigo) === String(d.codigo) ||
        String(c.telefono) === String(d.codigo)
      );
      result = cli ? { ok: true, cliente: cli } : { ok: false };
      break;
    }

    // Guarda los criterios (categorías, talla, género, cantidad) usados al
    // generar el catálogo de un afiliado, para poder "refrescarlo" después
    // con stock actualizado sin rearmar la selección desde cero.
    case "GUARDAR_RECETA_CATALOGO": {
      if (!esAdmin) return forbidden();
      await sb.update("vendedores", d.vendedor, { catalogoReceta: d.receta });
      result = { ok: true };
      break;
    }

    case "GET_TIENDA": {
      if (!esAdmin) return forbidden();
      const [prods, peds, cups, clis, cfgDoc] = await Promise.all([
        sb.getAll("stock"),
        sb.getAll("pedidos"),
        sb.getAll("cupones"),
        sb.getAll("clientes"),
        sb.get("config", "settings"),
      ]);
      result = {
        ok: true,
        productos: prods.filter(p => p.estado !== "inactivo"),
        pedidos:   peds,
        cupones:   cups,
        clientes:  clis,
        config:    sanearConfigPublico(cfgDoc)
      };
      break;
    }

    case "ELIMINAR_PEDIDO": {
      if (!esAdmin) return forbidden();
      // Un pedido activo (Pendiente / Despachado) tiene piezas apartadas: si se borra sin devolverlas quedan
      // descontadas de bodega/tienda para siempre. Los Entregados / Cancelados / No entregados ya se resolvieron.
      const pedEl = await sb.get("pedidos", d.numeroPedido);
      if (pedEl && (pedEl.estado === "Pendiente" || pedEl.estado === "Despachado") && !pedEl.stockLiberado && !pedEl.stockActualizado) {
        await liberarStockPedido(sb, { ...pedEl, numeroPedido: d.numeroPedido });
      }
      await sb.delete("pedidos", d.numeroPedido);
      result = { ok: true };
      break;
    }

    case "CREAR_CUPON": {
      if (!esAdmin) return forbidden();
      const tiendaCup = ["sv", "us"].includes(d.tienda) ? d.tienda : "ambas";
      await sb.set("cupones", d.codigo, {
        codigo: d.codigo, tipo: d.tipo || "porcentaje_total",
        descuento: parseFloat(d.descuento) || 0, categorias: d.categorias || "",
        // descuentoFijo no se guardaba: los cupones de monto fijo / monto mínimo quedaban en $0.
        descuentoFijo: parseFloat(d.descuentoFijo) || 0,
        montoMinimo: parseFloat(d.montoMinimo) || 0, limiteUsos: parseInt(d.limiteUsos) || 0,
        // Condiciones: tope del descuento ($, 0 = sin tope), en qué tienda vale, fecha de vencimiento (inclusive)
        // y un solo uso por cliente (se identifica por correo o teléfono).
        descuentoMax: Math.max(0, parseFloat(d.descuentoMax) || 0), tienda: tiendaCup,
        vence: /^\d{4}-\d{2}-\d{2}$/.test(d.vence || "") ? d.vence : "",
        unoPorCliente: !!d.unoPorCliente, usadoPor: [],
        usosActuales: 0, activo: d.activo !== false
      });
      result = { ok: true };
      break;
    }

    case "TOGGLE_CUPON": {
      if (!esAdmin) return forbidden();
      await sb.update("cupones", d.codigo, { activo: !!d.activo });
      result = { ok: true };
      break;
    }

    case "ELIMINAR_CUPON": {
      if (!esAdmin) return forbidden();
      await sb.delete("cupones", d.codigo);
      result = { ok: true };
      break;
    }

    // Historial global de variedad: registra cuándo se le mostró por última
    // vez cada código a CUALQUIER afiliado, para repartir la variedad del
    // inventario entre todos en vez de que cada afiliado solo evite repetirse
    // a sí mismo (con varios afiliados compartiendo el mismo stock, eso
    // agotaba la variedad rápido — cada uno terminaba con el mismo catálogo).
    case "GET_VARIEDAD_CATALOGO_GLOBAL": {
      if (!esAdmin) return forbidden();
      const reg = await sb.get("config", "variedad_catalogo_global") || { codigos: {} };
      result = { ok: true, codigos: reg.codigos || {} };
      break;
    }

    case "REGISTRAR_VARIEDAD_CATALOGO_GLOBAL": {
      if (!esAdmin) return forbidden();
      const reg = await sb.get("config", "variedad_catalogo_global") || { codigos: {} };
      reg.codigos = reg.codigos || {};
      const ts = Date.now();
      (Array.isArray(d.codigos) ? d.codigos : []).forEach(c => { reg.codigos[c] = ts; });
      // Limitar el registro a 2000 códigos más recientes para no inflarlo indefinidamente
      const entradas = Object.entries(reg.codigos).sort((a, b) => b[1] - a[1]);
      if (entradas.length > 2000) reg.codigos = Object.fromEntries(entradas.slice(0, 2000));
      await sb.set("config", "variedad_catalogo_global", reg);
      result = { ok: true };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
