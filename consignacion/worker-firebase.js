// ═══════════════════════════════════════════════════════════════════
//  VEREX API — Cloudflare Worker con Supabase — v2026.06
//
//  SECRETS en Cloudflare (Settings → Variables → Secrets):
//    SUPABASE_URL         → URL del proyecto (ej: https://xxx.supabase.co)
//    SUPABASE_SERVICE_KEY → service_role key (Settings → API en Supabase)
//    SECRET_PASS          → contraseña del admin
//    SECRET_KEY           → clave legacy de vendedores
//    IMAGEKIT_PRIVATE_KEY → clave privada de ImageKit
// ═══════════════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json"
};

const ADMIN_WA = "50371250725"; // WhatsApp VEREX

export default {
  // ── CRON DIARIO: alertas pedidos pendientes +2 días ──────────────
  async scheduled(event, env, ctx) {
    const sb    = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const todos = await sb.getAll("pedidos");
    const hace2dias = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const pendientes = todos.filter(p =>
      (p.estado === "Pendiente" || p.estado === "En camino") &&
      new Date(p.fecha).getTime() < hace2dias
    );
    if (!pendientes.length) return;

    const lista = pendientes.map(p =>
      `• ${p.numeroPedido} — ${p.cliente} ($${parseFloat(p.total||0).toFixed(2)}) — ${p.estado}`
    ).join("\n");

    const msg = encodeURIComponent(
      `⚠️ VEREX — ${pendientes.length} pedido(s) llevan +2 días sin actualizar:\n\n${lista}\n\n📋 Actualiza el estado en: https://admin-tienda.pages.dev`
    );

    // Enviar via CallMeBot API (gratis, solo requiere registro inicial)
    const apikey = env.CALLMEBOT_KEY || "";
    if (apikey) {
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${ADMIN_WA}&text=${msg}&apikey=${apikey}`).catch(()=>{});
    }
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("", { headers: CORS });

    const sb = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // ── GET: catálogo público ──────────────────────────────────────
    if (request.method === "GET") {
      try {
        const [prods, cups, cfgDoc] = await Promise.all([
          sb.getAll("stock"),
          sb.getAll("cupones"),
          sb.get("config", "settings"),
        ]);
        return json({
          productos: prods.filter(p => (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") && p.estado !== "inactivo"),
          cupones:   cups.filter(c => c.activo !== false && c.activo !== "false"),
          config:    cfgDoc || {}
        });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    try {
      const d = await request.json();

      // ── Verificación de contraseña (endpoint público de login) ───
      if (d.accion === "VERIFICAR_PASS") {
        const ok = await verificarPassword(d._pass, env, sb);
        return json({ ok });
      }

      // ── 2FA: Enviar OTP por Telegram ───────────────────────────
      if (d.accion === "ENVIAR_OTP") {
        const ok = await verificarPassword(d._pass, env, sb);
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        const otp  = String(Math.floor(100000 + Math.random() * 900000));
        const exp  = Date.now() + 5 * 60 * 1000; // 5 minutos
        await sb.update("config", "settings", { otp, otpExp: exp });
        const TELEGRAM_BOT = "8876219004:AAHZavenfX0SjTYZbzqGTEGBxD0P4VKvtLM";
        const TELEGRAM_CHAT = "6788653579";
        const msg = `🔐 *VEREX Admin*\n\nCódigo de acceso: *${otp}*\n\nVálido por 5 minutos.`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "Markdown" })
        });
        return json({ ok: true });
      }

      // ── 2FA: Verificar OTP ─────────────────────────────────────
      if (d.accion === "VERIFICAR_OTP") {
        const ok = await verificarPassword(d._pass, env, sb);
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        const cfg = await sb.get("config", "settings");
        if (!cfg || !cfg.otp || !cfg.otpExp) return json({ ok: false, error: "Sin OTP" });
        if (Date.now() > cfg.otpExp) {
          await sb.update("config", "settings", { otp: null, otpExp: null });
          return json({ ok: false, error: "OTP expirado" });
        }
        if (String(d.codigo).trim() !== String(cfg.otp)) return json({ ok: false, error: "Código incorrecto" });
        await sb.update("config", "settings", { otp: null, otpExp: null }); // Invalidar OTP usado
        return json({ ok: true });
      }

      // esAdmin: acepta SECRET_PASS (env var) O el hash guardado en Supabase
      const esAdmin = (await verificarPassword(d._pass, env, sb)) ||
                      (d.key && d.key === env.SECRET_KEY);

      let result;

      switch (d.accion) {

        // ══ STOCK ════════════════════════════════════════════════
        case "STOCK_GET_ALL": {
          const docs = await sb.getAll("stock");
          result = { ok: true, stock: docs.filter(p => p.estado !== "inactivo") };
          break;
        }

        case "STOCK_REGISTRAR": {
          if (!esAdmin) return forbidden();
          const items = Array.isArray(d.items) ? d.items : [d];
          const codigos = [];
          // Cargar stock UNA sola vez fuera del loop (evita race condition y N queries)
          const allStockCache = await sb.getAll("stock");
          const codigosUsados = new Set(allStockCache.map(s => s.codigo));
          for (const item of items) {
            // Auto-generar código si no viene o se pide
            let codigo = item.codigo;
            if (!codigo || item.autoGenerarCodigo) {
              // Prefijo de material
              const mat = String(item.material || "").toLowerCase();
              const prefMat = mat.includes("oro laminado") ? "PO"
                            : mat.includes("14 kil") || mat.includes("14k") ? "OR14"
                            : mat.includes("10 kil") || mat.includes("10k") ? "OR10"
                            : mat.includes("oro")          ? "OR"
                            : mat.includes("acero")        ? "A"
                            : mat.includes("reloj")        ? "W"
                            : mat.includes("plata")        ? "P"
                            : "";
              const prefCat = String(item.categoria || "GEN").toUpperCase().slice(0, 2);
              const prefijo = prefMat ? `${prefMat}-${prefCat}` : prefCat;
              let maxNum = 0;
              allStockCache.forEach(s => {
                const base = String(s.codigoBase || s.codigo || "");
                if (base.startsWith(prefijo)) {
                  const num = parseInt(base.replace(prefijo, "")) || 0;
                  if (num > maxNum) maxNum = num;
                }
              });
              // Anti-colisión: incrementar hasta encontrar código libre
              let codigoBase;
              do {
                maxNum++;
                codigoBase = `${prefijo}${String(maxNum).padStart(3, "0")}`;
              } while (codigosUsados.has(codigoBase) || codigosUsados.has(`${codigoBase}T${item.talla}`));
              codigo = item.talla ? `${codigoBase}T${item.talla}` : codigoBase;
              item.codigoBase = item.codigoBase || codigoBase;
              codigosUsados.add(codigo); // Registrar para evitar colisión en el mismo lote
            }
            const qty = parseInt(item.cantidad) || 1;
            const doc = {
              ...item,
              codigo,
              precio:             Math.round((parseFloat(item.precio) || 0) * 100) / 100,
              stock_bodega:       item.stock_bodega       !== undefined ? parseInt(item.stock_bodega)       : qty,
              stock_tienda:       item.stock_tienda        !== undefined ? parseInt(item.stock_tienda)        : 0,
              stock_consignacion: item.stock_consignacion !== undefined ? parseInt(item.stock_consignacion) : 0,
              stock_reservado:    item.stock_reservado     !== undefined ? parseInt(item.stock_reservado)     : 0,
              stock_vendido:      item.stock_vendido       !== undefined ? parseInt(item.stock_vendido)       : 0,
              stock_total:        item.stock_total         !== undefined ? parseInt(item.stock_total)         : qty,
              estado:             item.estado || "bodega",
              fechaRegistro:      item.fechaRegistro || new Date().toISOString(),
            };
            await sb.set("stock", codigo, doc);
            codigos.push(codigo);
          }
          result = { ok: true, codigos };
          break;
        }

        // Reparar productos existentes sin campos de stock
        case "STOCK_REPARAR_CAMPOS": {
          if (!esAdmin) return forbidden();
          const todos = await sb.getAll("stock");
          let reparados = 0;
          for (const p of todos) {
            if (p.stock_bodega === undefined || p.stock_bodega === null) {
              const qty = parseInt(p.cantidad) || 1;
              await sb.update("stock", p.id || p.codigo, {
                stock_bodega:       qty,
                stock_tienda:       0,
                stock_consignacion: 0,
                stock_reservado:    0,
                stock_vendido:      0,
                stock_total:        qty,
                estado:             p.estado || "bodega",
              });
              reparados++;
            }
          }
          result = { ok: true, reparados, total: todos.length };
          break;
        }

        case "STOCK_ELIMINAR": {
          if (!esAdmin) return forbidden();
          await sb.delete("stock", d.codigo);
          result = { ok: true };
          break;
        }

        case "STOCK_ACTUALIZAR_CANTIDADES": {
          if (!esAdmin) return forbidden();
          const notFound = [];
          for (const item of (d.items || [])) {
            const doc = await sb.get("stock", item.codigo);
            if (doc) {
              await sb.update("stock", item.codigo, {
                stock_bodega:       item.stock_bodega       ?? doc.stock_bodega,
                stock_tienda:       item.stock_tienda       ?? doc.stock_tienda,
                stock_consignacion: item.stock_consignacion ?? doc.stock_consignacion,
              });
            } else {
              notFound.push(item.codigo);
            }
          }
          result = { ok: true, notFound };
          break;
        }

        // ══ VENDEDORES ═══════════════════════════════════════════
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

        // ══ CONSIGNACION ══════════════════════════════════════════
        case "GET_CONSIGNACION": {
          if (!esAdmin) return forbidden();
          const [cons, vends, stock] = await Promise.all([
            sb.getAll("consignacion"),
            sb.getAll("vendedores"),
            sb.getAll("stock"),
          ]);
          result = { ok: true, consignacion: cons, vendedores: vends, stock, productos: stock };
          break;
        }

        case "REGISTRAR_ENTREGA": {
          if (!esAdmin) return forbidden();
          const items = d.items || [];
          for (const item of items) {
            const id = item.id || `CONS_${Date.now()}_${item.codigo}`;
            await sb.set("consignacion", id, {
              id, vendedor: d.vendedor, codigo: item.codigo,
              nombre: item.nombre, codigoBase: item.codigoBase || item.codigo,
              talla: item.talla || "", nombre_base: item.nombre_base || item.nombre,
              categoria: item.categoria || "", precio: item.precio || 0,
              cantidad: item.cantidad || 1, vendido: 0,
              foto: item.foto || "", fecha: new Date().toISOString(), estado: "activo"
            });
            const s = await sb.get("stock", item.codigo);
            if (s) {
              await sb.update("stock", item.codigo, {
                stock_bodega:       Math.max(0, (parseInt(s.stock_bodega)||0) - (item.cantidad||1)),
                stock_consignacion: (parseInt(s.stock_consignacion)||0) + (item.cantidad||1)
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "REGISTRAR_VENTA": {
          if (!esAdmin) return forbidden();
          const cons = await sb.get("consignacion", d.id);
          if (!cons) { result = { ok: false, error: "Item no encontrado" }; break; }
          const nuevoVendido = (parseInt(cons.vendido)||0) + (parseInt(d.cantidad)||1);
          await sb.update("consignacion", d.id, { vendido: nuevoVendido });
          const s = await sb.get("stock", cons.codigo);
          if (s) {
            await sb.update("stock", cons.codigo, {
              stock_vendido: (parseInt(s.stock_vendido)||0) + (parseInt(d.cantidad)||1)
            });
          }
          result = { ok: true };
          break;
        }

        case "REGISTRAR_DEVOLUCION": {
          if (!esAdmin) return forbidden();
          const items = d.items || [];
          const devId = `DEV_${Date.now()}`;
          await sb.set("devoluciones", devId, {
            id: devId, vendedor: d.vendedor,
            fecha: new Date().toISOString(), items: JSON.stringify(items)
          });
          for (const item of items) {
            const cons = await sb.get("consignacion", item.id);
            if (cons) {
              const nuevaCant = Math.max(0, (parseInt(cons.cantidad)||0) - (item.cantidad||1));
              await sb.update("consignacion", item.id, {
                cantidad: nuevaCant,
                estado: nuevaCant <= parseInt(cons.vendido||0) ? "devuelto" : "activo"
              });
            }
            const s = await sb.get("stock", item.codigo);
            if (s) {
              await sb.update("stock", item.codigo, {
                stock_bodega:       (parseInt(s.stock_bodega)||0) + (item.cantidad||1),
                stock_consignacion: Math.max(0, (parseInt(s.stock_consignacion)||0) - (item.cantidad||1))
              });
            }
          }
          result = { ok: true, devolucionId: devId, fecha: new Date().toISOString() };
          break;
        }

        case "ELIMINAR_ITEM_CONSIGNACION": {
          if (!esAdmin) return forbidden();
          // Restaurar stock_consignacion antes de borrar
          const itemCons = await sb.get("consignacion", d.id);
          if (itemCons && itemCons.codigo) {
            const cantRestaurar = Math.max(0, (parseInt(itemCons.cantidad)||0) - (parseInt(itemCons.vendido)||0));
            if (cantRestaurar > 0) {
              const prodStock = await sb.get("stock", itemCons.codigo);
              if (prodStock) {
                await sb.update("stock", itemCons.codigo, {
                  stock_consignacion: Math.max(0, (parseInt(prodStock.stock_consignacion)||0) - cantRestaurar),
                  stock_bodega: (parseInt(prodStock.stock_bodega)||0) + cantRestaurar
                });
              }
            }
          }
          await sb.delete("consignacion", d.id);
          result = { ok: true };
          break;
        }

        // ══ CORTES ════════════════════════════════════════════════
        case "CERRAR_CORTE": {
          if (!esAdmin) return forbidden();
          for (const id of (d.devueltos || [])) {
            await sb.update("consignacion", id, { estado: "devuelto" });
          }
          const allCons = await sb.query("consignacion", "vendedor", "==", d.vendedor);
          for (const c of allCons.filter(c => c.estado === "activo")) {
            await sb.update("consignacion", c.id, { vendido: 0 });
          }
          await sb.update("vendedores", d.vendedor, {
            totalVendido: 0,
            fechaCorte: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "GUARDAR_CORTE_HISTORIAL": {
          if (!esAdmin) return forbidden();
          const corteId = String(d.id);
          await sb.set("cortes_historial", corteId, {
            id: corteId,
            vendedor:          d.vendedor,
            vendedorNombre:    d.vendedorNombre    || "",
            vendedorTelefono:  d.vendedorTelefono  || "",
            fecha:             d.fecha || new Date().toISOString(),
            totalVendido:      d.totalVendido,
            comisionPct:       d.comisionPct,
            gananciaVendedor:  d.gananciaVendedor,
            aPagarVerex:       d.aPagarVerex,
            items:             JSON.stringify(d.items || []),
          });
          result = { ok: true };
          break;
        }

        case "GET_HISTORIAL_CORTES": {
          const cortes = await sb.query("cortes_historial", "vendedor", "==", d.vendedor);
          result = { ok: true, cortes };
          break;
        }

        // ══ VENTAS DIRECTAS ═══════════════════════════════════════
        case "REGISTRAR_VENTA_DIRECTA": {
          if (!esAdmin) return forbidden();
          const vdId = d.id || `VD_${Date.now()}`;
          await sb.set("ventas_directas", vdId, {
            id: vdId, fecha: d.fecha || new Date().toISOString(),
            cliente: d.cliente || "", telefono: d.telefono || "",
            items: JSON.stringify(d.items || []),
            subtotal: d.subtotal || d.total || 0,
            descuento: d.descuento || 0,
            total: d.total || 0,
            tipo: d.tipo || "contado",
            enganche: d.enganche || 0,
            saldoPendiente: d.saldoPendiente || 0,
            nota: d.nota || "",
            estado: d.estado || "pagado"
          });
          for (const item of (d.items || [])) {
            const s = await sb.get("stock", item.codigo);
            if (s) {
              const cant = parseInt(item.cantidad) || 1;
              const bodega  = parseInt(s.stock_bodega)  || 0;
              const tienda  = parseInt(s.stock_tienda)  || 0;
              // Descontar primero de tienda si hay, luego de bodega
              let descBodega = 0, descTienda = 0;
              if (tienda >= cant) {
                descTienda = cant;
              } else {
                descTienda = tienda;
                descBodega = cant - tienda;
              }
              await sb.update("stock", item.codigo, {
                stock_tienda: Math.max(0, tienda - descTienda),
                stock_bodega: Math.max(0, bodega - descBodega)
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "GET_VENTAS_DIRECTAS": {
          if (!esAdmin) return forbidden();
          let ventas = await sb.getAll("ventas_directas");
          if (d.estado) ventas = ventas.filter(v => v.estado === d.estado);
          ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          result = { ok: true, ventas };
          break;
        }

        case "REGISTRAR_ABONO": {
          if (!esAdmin) return forbidden();
          const abonoId = `AB_${Date.now()}`;
          await sb.set("abonos", abonoId, {
            id: abonoId, ventaId: d.ventaId,
            fecha: new Date().toISOString(), monto: d.monto || 0
          });
          const vd = await sb.get("ventas_directas", d.ventaId);
          if (vd) {
            const nuevoSaldo = Math.max(0, (parseFloat(vd.saldoPendiente)||0) - (d.monto||0));
            await sb.update("ventas_directas", d.ventaId, {
              saldoPendiente: nuevoSaldo,
              estado: nuevoSaldo <= 0 ? "pagado" : "credito"
            });
          }
          result = { ok: true };
          break;
        }

        case "GET_ABONOS_VENTA": {
          if (!esAdmin) return forbidden();
          const abonos = await sb.query("abonos", "ventaId", "==", d.ventaId);
          result = { ok: true, abonos };
          break;
        }

        case "REGISTRAR_VENTA_VENDEDOR": {
          const consV = await sb.get("consignacion", d.id);
          if (!consV) { result = { ok: false, error: "Item no encontrado" }; break; }
          const nuevoVendidoV = (parseInt(consV.vendido)||0) + (parseInt(d.cantidad)||1);
          await sb.update("consignacion", d.id, { vendido: nuevoVendidoV });
          const sV = await sb.get("stock", consV.codigo);
          if (sV) {
            await sb.update("stock", consV.codigo, {
              stock_vendido: (parseInt(sV.stock_vendido)||0) + (parseInt(d.cantidad)||1)
            });
          }
          result = { ok: true, ventaId: d.id };
          break;
        }

        case "GET_HISTORIAL_VENTAS": {
          if (!esAdmin) return forbidden();
          const [vd, peds, consig] = await Promise.all([
            sb.getAll("ventas_directas"),
            sb.getAll("pedidos"),
            sb.getAll("consignacion")
          ]);
          const unificadas = [
            ...vd.map(v => ({
              id: v.id, fecha: v.fecha, tipo: "directa",
              cliente: v.cliente || "—", telefono: v.telefono || "",
              total: parseFloat(v.total || 0),
              estado: v.estado || "pagado",
              saldoPendiente: parseFloat(v.saldoPendiente || 0),
              items: v.items || "[]",
              nota: v.nota || ""
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
            ...consig.filter(c => parseInt(c.vendido) > 0).map(c => ({
              id: c.id, fecha: c.fecha, tipo: "consignacion",
              cliente: c.vendedor || "—", telefono: "",
              total: parseFloat(c.precio || 0) * parseInt(c.vendido || 1),
              estado: "pagado",
              saldoPendiente: 0,
              items: JSON.stringify([{ nombre: c.nombre || c.codigo, cantidad: c.vendido, precio: c.precio }]),
              nota: ""
            }))
          ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          result = { ok: true, ventas: unificadas };
          break;
        }

        case "GET_VENTAS_VENDEDOR": {
          const ventasV = await sb.query("consignacion", "vendedor", "==", d.vendedor);
          result = { ok: true, ventas: ventasV.filter(v => parseInt(v.vendido) > 0) };
          break;
        }

        case "SOLICITAR_CORRECCION_VENTA": {
          const solId = `SOL_${Date.now()}`;
          await sb.set("solicitudes_correccion", solId, {
            id: solId, ventaId: d.ventaId || "",
            vendedor: d.vendedor || "", motivo: d.motivo || "",
            codigo: d.codigo || "", estado: "pendiente",
            fecha: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "GET_DEVOLUCIONES_VENDEDOR": {
          const devs = await sb.query("devoluciones", "vendedor", "==", d.vendedor);
          result = { ok: true, devoluciones: devs };
          break;
        }

        // ══ CATÁLOGO PÚBLICO POR VENDEDOR (sin auth) ══════════════
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
          if (vend.fechaCorte) {
            const diasDesdeCorte = (Date.now() - new Date(vend.fechaCorte).getTime()) / (1000 * 60 * 60 * 24);
            if (diasDesdeCorte > 30) { result = { ok: false, razon: "vencido" }; break; }
          }
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

        // ══ PEDIDOS TIENDA ════════════════════════════════════════
        case "GUARDAR_PEDIDO": {
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
            // Reservado → Vendido
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
            // Reservado → regresa a Tienda
            for (const item of itemsEst) {
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
            await sb.update("pedidos", d.numeroPedido, { stockLiberado: true });
          }

          // ── Notificar al cliente si fue Despachado, ordenó por correo y tiene correo ──
          if (d.estado === "Despachado" && pedidoActual.canal === "correo" && pedidoActual.correo) {
            try {
              const RESEND_KEY = env.RESEND_KEY;
              if (RESEND_KEY) {
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
                  body: JSON.stringify({
                    from: "VEREX Store <hola@verexstore.com>",
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

        // ══ CLIENTES ══════════════════════════════════════════════
        case "GET_CLIENTES": {
          if (!esAdmin) return forbidden();
          const clientes = await sb.getAll("clientes");
          result = { ok: true, clientes };
          break;
        }

        case "GUARDAR_CLIENTE": {
          await sb.set("clientes", d.codigo || `CLI_${Date.now()}`, d);
          result = { ok: true };
          break;
        }

        // ══ CUPONES ═══════════════════════════════════════════════
        case "USAR_CUPON": {
          const cup = await sb.get("cupones", d.codigo);
          if (!cup) { result = { ok: false, error: "Cupón no encontrado" }; break; }
          if (cup.activo === false || cup.activo === "false") {
            result = { ok: false, error: "Cupón inactivo" }; break;
          }
          const usosActuales = (parseInt(cup.usosActuales) || 0);
          const limiteUsos   = parseInt(cup.limiteUsos) || 0;
          if (limiteUsos > 0 && usosActuales >= limiteUsos) {
            result = { ok: false, error: "Cupón agotado" }; break;
          }
          await sb.update("cupones", d.codigo, {
            usosActuales: usosActuales + 1,
            // Desactivar automáticamente si llegó al límite
            activo: limiteUsos > 0 ? (usosActuales + 1 < limiteUsos) : true
          });
          result = { ok: true };
          break;
        }

        // ══ CONFIG ════════════════════════════════════════════════
        case "GET_CONFIG": {
          const cfg = await sb.get("config", "settings");
          result = { ok: true, config: cfg || {} };
          break;
        }

        case "GUARDAR_CONFIG": {
          if (!esAdmin) return forbidden();
          await sb.update("config", "settings", d.config || {});
          result = { ok: true };
          break;
        }

        // ══ GENERAR CÓDIGO ════════════════════════════════════════
        case "GENERAR_CODIGO": {
          const cat = String(d.categoria || "GEN").toUpperCase().slice(0, 2);
          const mat = String(d.material || "").toLowerCase();
          const matChar = mat.includes("laminado")  ? "L"
                        : mat.includes("oro")       ? "O"
                        : mat.includes("acero")     ? "A"
                        : mat.includes("reloj")     ? "W"
                        : mat.includes("plata")     ? "P"
                        : "X";
          const prefijo = cat + matChar;
          const allStock = await sb.getAll("stock");
          let maxNum = 0;
          allStock.forEach(s => {
            const base = String(s.codigoBase || s.codigo || "").toUpperCase();
            if (base.startsWith(prefijo)) {
              const num = parseInt(base.slice(prefijo.length).replace(/T[\d.]+$/i, "")) || 0;
              if (num > maxNum) maxNum = num;
            }
          });
          result = { ok: true, codigo: `${prefijo}${String(maxNum + 1).padStart(3, "0")}` };
          break;
        }

        // ══ CATÁLOGO / TIENDA PÚBLICA ════════════════════════════
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
            p.estado !== "inactivo"
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
            productos: final,
            cupones:   cups.filter(c => c.activo !== false && c.activo !== "false"),
            config:    cfg2
          };
          break;
        }

        case "NUEVO_PEDIDO": {
          const now      = new Date();
          const dd       = String(now.getDate()).padStart(2, "0");
          const mm       = String(now.getMonth() + 1).padStart(2, "0");
          const prefijo  = `#10${dd}${mm}`;
          const todosLosPedidos = await sb.getAll("pedidos");
          const hoyStr   = now.toISOString().slice(0, 10);
          const correl   = todosLosPedidos.filter(p => (p.fecha || "").slice(0, 10) === hoyStr).length + 1;
          const numeroPedido = `${prefijo}-${String(correl).padStart(3, "0")}`;
          const clientes = await sb.getAll("clientes");
          const cliExist = clientes.find(c => String(c.telefono) === String(d.telefono));
          let codigoCliente = "";
          if (cliExist) {
            codigoCliente = cliExist.codigo;
            const updCli = { totalPedidos: (parseInt(cliExist.totalPedidos)||0) + 1 };
            if (d.correo && !cliExist.correo) updCli.correo = d.correo;
            await sb.update("clientes", codigoCliente, updCli);
          } else {
            codigoCliente = `CVX-${String(clientes.length + 1).padStart(3, "0")}`;
            await sb.set("clientes", codigoCliente, {
              codigo: codigoCliente, nombre: d.cliente, telefono: d.telefono,
              correo: d.correo || "",
              municipio: d.municipio || "", direccion: d.direccion || "",
              departamento: d.departamento || "", totalPedidos: 1,
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
            codigoCliente: codigoCliente || "", canal: d.canal || "whatsapp"
          });

          // ── Reservar stock inmediatamente ──────────────────────────
          let itemsPed = [];
          try { itemsPed = typeof d.items === "string" ? JSON.parse(d.items) : (d.items || []); } catch(_) {}
          for (const item of itemsPed) {
            if (!item.codigo) continue;
            const prod = await sb.get("stock", item.codigo);
            if (!prod) continue;
            const qty = parseInt(item.cantidad || 1);
            await sb.update("stock", item.codigo, {
              stock_tienda:    Math.max(0, (parseInt(prod.stock_tienda)||0) - qty),
              stock_reservado: (parseInt(prod.stock_reservado)||0) + qty
            });
          }

          // ── Notificación por email ─────────────────────────────────
          try {
            const RESEND_KEY = env.RESEND_KEY;
            if (!RESEND_KEY) throw new Error("RESEND_KEY no configurada en Cloudflare Secrets");
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: "VEREX Store <hola@verexstore.com>",
                to:   ["hola@verexstore.com"],
                subject: `🛍️ Nuevo Pedido ${numeroPedido} — ${d.total}`,
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
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
                  body: JSON.stringify({
                    from: "VEREX Store <hola@verexstore.com>",
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

        case "BUSCAR_CLIENTE": {
          const cliAll = await sb.getAll("clientes");
          const cli = cliAll.find(c =>
            String(c.codigo) === String(d.codigo) ||
            String(c.telefono) === String(d.codigo)
          );
          result = cli ? { ok: true, cliente: cli } : { ok: false };
          break;
        }

        case "VERIFICAR_TOKEN": {
          const vend = await sb.get("vendedores", d.vendedor);
          if (!vend) { result = { ok: false, razon: "no_encontrado" }; break; }
          if (String(vend.tokenInventario) !== String(d.token)) {
            result = { ok: false, razon: "token_invalido" }; break;
          }
          // Validar 30 días desde último corte
          if (vend.fechaCorte) {
            const diasDesdeCorte = (Date.now() - new Date(vend.fechaCorte).getTime()) / (1000 * 60 * 60 * 24);
            if (diasDesdeCorte > 30) {
              result = { ok: false, razon: "vencido" }; break;
            }
          }
          result = { ok: true, vendedor: vend };
          break;
        }

        // ══ ADMIN TIENDA ══════════════════════════════════════════
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
            config:    cfgDoc || {}
          };
          break;
        }

        case "CREAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          const prodId = d.codigo || `PROD_${Date.now()}`;
          await sb.set("stock", prodId, {
            codigo:             prodId,
            codigoBase:         prodId,
            nombre:             d.nombre || "",
            precio:             Math.round((parseFloat(d.precio) || 0) * 100) / 100,
            foto:               d.img || d.foto || "",
            descripcion:        d.caracteristicas || "",
            descripcionTienda:  d.caracteristicas || "",
            categoria:          d.categoria || "",
            talla:              "",
            stock_bodega:       parseInt(d.cantidad) || 0,
            stock_tienda:       0,
            stock_consignacion: 0,
            stock_vendido:      0,
            enCatalogo:         d.enCatalogo === true || d.enCatalogo === "true" || false,
            estado:             "activo",
            fechaRegistro:      new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "ELIMINAR_PEDIDO": {
          if (!esAdmin) return forbidden();
          await sb.delete("pedidos", d.numeroPedido);
          result = { ok: true };
          break;
        }

        // ══ ALIAS ════════════════════════════════════════════════
        case "GET_STOCK": {
          const stock = await sb.getAll("stock");
          result = { ok: true, stock: stock.filter(p => p.estado !== "inactivo") };
          break;
        }

        // ══ STOCK MOVIMIENTOS ════════════════════════════════════
        case "STOCK_ASIGNAR_TIENDA": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const disponible = parseInt(s.stock_bodega) || 0;
              const cant = Math.min(d.cantidad || 1, disponible); // no mover más de lo que hay
              if (cant <= 0) continue;
              await sb.update("stock", codigo, {
                stock_bodega: disponible - cant,
                stock_tienda: (parseInt(s.stock_tienda)||0) + cant,
                enCatalogo:   true,
                estado:       "tienda"
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "STOCK_ASIGNAR_VENDEDOR": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const disponible = parseInt(s.stock_bodega) || 0;
              const cant = Math.min(d.cantidad || 1, disponible);
              if (cant <= 0) continue;
              await sb.update("stock", codigo, {
                stock_bodega:       disponible - cant,
                stock_consignacion: (parseInt(s.stock_consignacion)||0) + cant,
                estado:             "consignacion"
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "STOCK_DEVOLVER_BODEGA": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const origen = d.origen || "tienda";
              // Determinar cuánto hay realmente en el origen para no inventar stock
              const enOrigen = origen === "tienda"
                ? (parseInt(s.stock_tienda)||0)
                : (parseInt(s.stock_consignacion)||0);
              const cant = Math.min(d.cantidad || 1, enOrigen);
              if (cant <= 0) continue; // ya no hay nada que devolver
              const updates = {
                stock_bodega: (parseInt(s.stock_bodega)||0) + cant,
                estado: "bodega"
              };
              if (origen === "tienda") {
                updates.stock_tienda  = enOrigen - cant;
                updates.enCatalogo    = false;
              } else {
                updates.stock_consignacion = enOrigen - cant;
              }
              await sb.update("stock", codigo, updates);
            }
          }
          result = { ok: true };
          break;
        }

        // ══ PRODUCTOS ════════════════════════════════════════════
        case "EDITAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          const upd = {};
          if (d.nombre          !== undefined) upd.nombre            = d.nombre;
          if (d.precio          !== undefined) upd.precio            = Math.round((parseFloat(d.precio) || 0) * 100) / 100;
          if (d.img             !== undefined) upd.foto              = d.img;
          if (d.descripcion     !== undefined) upd.descripcionTienda = d.descripcion;
          if (d.destacado       !== undefined) upd.destacado         = d.destacado;
          if (d.enCatalogo      !== undefined) upd.enCatalogo        = Boolean(d.enCatalogo);
          if (d.stock_bodega    !== undefined) upd.stock_bodega      = Math.max(0, parseInt(d.stock_bodega) || 0);
          if (d.caracteristicas !== undefined) upd.caracteristicas   = d.caracteristicas;
          if (d.material        !== undefined) upd.material          = d.material;
          if (d.caracterEspecial !== undefined) upd.caracterEspecial = d.caracterEspecial;
          // Cambio de código: copiar fila con nuevo código y marcar vieja inactiva
          if (d.nuevo_codigo && d.nuevo_codigo !== d.codigo) {
            const viejo = await sb.get("stock", d.codigo);
            if (viejo) {
              const nueva = { ...viejo, ...upd, codigo: d.nuevo_codigo };
              delete nueva.id;
              await sb.set("stock", d.nuevo_codigo, nueva);
              await sb.update("stock", d.codigo, { estado: "inactivo" });
            }
          } else {
            await sb.update("stock", d.codigo, upd);
          }
          result = { ok: true };
          break;
        }

        case "ROTAR_CATALOGO": {
          if (!esAdmin) return forbidden();
          // d.porcentaje: número 0-100, d.guardarConfig: {dias, porcentaje} opcional
          const todos = await sb.getAll("stock");
          const activos = todos.filter(p => p.estado !== "inactivo");
          const pct  = Math.min(100, Math.max(0, parseInt(d.porcentaje) || 30));
          const cant = Math.max(1, Math.round(activos.length * pct / 100));
          // Shuffle Fisher-Yates
          const mezclados = activos.slice();
          for (let i = mezclados.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mezclados[i], mezclados[j]] = [mezclados[j], mezclados[i]];
          }
          const enCatalogoSet = new Set(mezclados.slice(0, cant).map(p => p.codigo));
          // Actualizar en lotes de 50 para no saturar con 1000+ productos
          const BATCH = 50;
          for (let i = 0; i < activos.length; i += BATCH) {
            await Promise.all(
              activos.slice(i, i + BATCH).map(p =>
                sb.update("stock", p.codigo, { enCatalogo: enCatalogoSet.has(p.codigo) })
              )
            );
          }
          // Guardar fecha de rotación en config
          const cfg = (await sb.get("config", "settings")) || {};
          if (!cfg.rotacion) cfg.rotacion = {};
          cfg.rotacion.ultimaRotacion = new Date().toISOString();
          if (d.guardarConfig) {
            cfg.rotacion.activa     = Boolean(d.guardarConfig.activa);
            cfg.rotacion.dias       = parseInt(d.guardarConfig.dias)       || 8;
            cfg.rotacion.porcentaje = parseInt(d.guardarConfig.porcentaje) || 30;
          }
          await sb.set("config", "settings", cfg);
          result = { ok: true, total: activos.length, enCatalogo: cant };
          break;
        }

        case "ELIMINAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          await sb.update("stock", d.codigo, { estado: "inactivo" });
          result = { ok: true };
          break;
        }

        // ══ ENTREGAS PENDIENTES ════════════════════════════════════
        case "REGISTRAR_ENTREGA_PENDIENTE": {
          if (!esAdmin) return forbidden();
          const entId = d.id || `ENT_${Date.now()}`;
          await sb.set("entregas", entId, {
            id: entId, vendedor: d.vendedor || "",
            fecha: new Date().toISOString(),
            items: JSON.stringify(d.items || []),
            estado: "pendiente",
            codigoRecibo: d.codigoRecibo || "",
            fechaConfirmacion: ""
          });
          result = { ok: true };
          break;
        }

        case "GET_ENTREGAS_PENDIENTES": {
          const ents = await sb.query("entregas", "vendedor", "==", d.vendedor);
          result = { ok: true, entregas: ents.filter(e => e.estado === "pendiente") };
          break;
        }

        case "GET_ENTREGAS_CONFIRMADAS": {
          if (!esAdmin) return forbidden();
          let allEnts;
          try { allEnts = await sb.getAll("entregas"); } catch(_) { allEnts = []; }
          result = { ok: true, entregas: allEnts.filter(e => e.estado === "confirmado") };
          break;
        }

        case "CONFIRMAR_ENTREGA_RECIBO": {
          const entDoc = await sb.get("entregas", d.id);
          if (!entDoc) { result = { ok: false, error: "Entrega no encontrada" }; break; }
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

        // ══ SOLICITUDES DE CORRECCIÓN ═════════════════════════════
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

        // ══ CONFIG / PASS ═════════════════════════════════════════
        case "ACTUALIZAR_PASS_HASH": {
          if (!esAdmin) return forbidden();
          await sb.update("config", "settings", { passHash: d.nuevoHash });
          result = { ok: true };
          break;
        }

        case "ACTUALIZAR_CONFIG": {
          if (!esAdmin) return forbidden();
          await sb.update("config", "settings", d.config || {});
          result = { ok: true };
          break;
        }

        // ══ CUPONES ═══════════════════════════════════════════════
        case "CREAR_CUPON": {
          if (!esAdmin) return forbidden();
          await sb.set("cupones", d.codigo, {
            codigo: d.codigo, tipo: d.tipo || "porcentaje_total",
            descuento: parseFloat(d.descuento) || 0, categorias: d.categorias || "",
            montoMinimo: parseFloat(d.montoMinimo) || 0, limiteUsos: parseInt(d.limiteUsos) || 0,
            usosActuales: 0, activo: true
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

        // ══ IMAGEN / FOTO ═════════════════════════════════════════
        case "ELIMINAR_FOTO": {
          if (!esAdmin) return forbidden();
          const ikKey = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikKey) { result = { ok: false, error: "ImageKit no configurado" }; break; }
          try {
            const urlFoto  = (d.url || "").split("?")[0];
            const pathMatch = urlFoto.match(/ik\.imagekit\.io\/[^/]+(.+)/);
            if (!pathMatch) { result = { ok: false, error: "URL de ImageKit inválida" }; break; }
            const filePath = pathMatch[1]; // ej: /consignacion/foto_abc.jpg
            const parts    = filePath.split("/");
            const name     = parts[parts.length - 1];
            const folder   = parts.slice(0, -1).join("/") || "/";
            const auth     = "Basic " + btoa(ikKey + ":");
            // Buscar fileId por nombre + carpeta
            const listRes  = await fetch(
              `https://api.imagekit.io/v1/files?name=${encodeURIComponent(name)}&path=${encodeURIComponent(folder)}&limit=1`,
              { headers: { "Authorization": auth } }
            );
            const files = await listRes.json();
            if (!Array.isArray(files) || files.length === 0) {
              result = { ok: false, error: "Archivo no encontrado en ImageKit" }; break;
            }
            await fetch(`https://api.imagekit.io/v1/files/${files[0].fileId}`, {
              method: "DELETE", headers: { "Authorization": auth }
            });
            result = { ok: true };
          } catch(eIK) {
            result = { ok: false, error: "Error ImageKit: " + eIK.message };
          }
          break;
        }

        case "IMAGEKIT_FIRMA": {
          if (!esAdmin) return forbidden();
          const ikPriv = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikPriv) { result = { ok: false, error: "ImageKit no configurado" }; break; }
          const token  = crypto.randomUUID();
          const expire = Math.floor(Date.now() / 1000) + 3600;
          const enc    = new TextEncoder();
          const ck     = await crypto.subtle.importKey("raw", enc.encode(ikPriv), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
          const sig    = await crypto.subtle.sign("HMAC", ck, enc.encode(token + expire));
          const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
          result = { ok: true, token, expire, signature };
          break;
        }

        case "SUBIR_FOTO": {
          // Permitir subida con key pública (desde celular) o con pass admin
          const keyOk = d.key === "VEREX_2026_PRO" || esAdmin;
          if (!keyOk) return forbidden();
          const ikKey = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikKey) { result = { ok: false, error: "ImageKit no configurado en secrets" }; break; }
          const authHeader = "Basic " + btoa(ikKey + ":");
          const ext        = (d.imagen || "").startsWith("data:image/png") ? "png" : "jpg";
          const fileName   = (d.nombre || ("foto_" + Date.now())) + "." + ext;
          const form       = new FormData();
          form.append("file",              d.imagen);
          form.append("fileName",          fileName);
          form.append("folder",            "/consignacion");
          form.append("useUniqueFileName", "true");
          const ikRes  = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
            method: "POST",
            headers: { "Authorization": authHeader },
            body:   form
          });
          const ikData = await ikRes.json();
          if (ikData.url) {
            const urlBase = ikData.url.split("?")[0];
            result = { ok: true, url: urlBase + "?tr=w-900,h-900,c-maintain_ratio" };
          } else {
            result = { ok: false, error: ikData.message || "Error subiendo foto" };
          }
          break;
        }

        case "ELIMINAR_FONDO": {
          if (!esAdmin) return forbidden();
          const hfKey = env.HF_TOKEN;
          if (!hfKey) { result = { ok: false, error: "HF_TOKEN no configurado en secrets" }; break; }
          try {
            // Convertir base64 a binario
            const base64 = (d.imagen || "").replace(/^data:image\/\w+;base64,/, "");
            const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            // Llamar a Hugging Face RMBG-1.4
            const hfRes = await fetch(
              "https://api-inference.huggingface.co/models/briaai/RMBG-1.4",
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${hfKey}`,
                  "Content-Type": "application/octet-stream"
                },
                body: binary
              }
            );
            if (!hfRes.ok) {
              const err = await hfRes.text();
              result = { ok: false, error: `HF error ${hfRes.status}: ${err}` };
              break;
            }
            // Convertir respuesta PNG a base64
            const pngBuffer = await hfRes.arrayBuffer();
            const pngBase64 = btoa(String.fromCharCode(...new Uint8Array(pngBuffer)));
            result = { ok: true, imagen: "data:image/png;base64," + pngBase64 };
          } catch(e) {
            result = { ok: false, error: e.message };
          }
          break;
        }

        case "BACKUP_SOLO": {
          if (!esAdmin) return forbidden();
          const tablasBk = ["stock","vendedores","consignacion","abonos","entregas","cortes","pedidos","clientes","cupones"];
          const backupData = {};
          for (const t of tablasBk) {
            try { backupData[t] = await sb.getAll(t); } catch(_) { backupData[t] = []; }
          }
          backupData._fecha = new Date().toISOString();
          result = { ok: true, backup: backupData };
          break;
        }

        case "GEMINI_TEST": {
          if (!esAdmin) return forbidden();
          const gKey = env.GEMINI_KEY;
          if (!gKey) { result = { ok: false, error: "No hay GEMINI_KEY" }; break; }
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}`);
          const data = await r.json();
          const nombres = (data.models || []).map(m => m.name).filter(n => n.includes("gemini"));
          result = { ok: r.ok, status: r.status, modelos: nombres, error: data.error?.message };
          break;
        }

        case "ANALIZAR_IMAGEN": {
          if (!esAdmin) return forbidden();
          try {
            const base64 = (d.imagen || "").replace(/^data:image\/[^;]+;base64,/, "");
            if (!base64) { result = { ok: false, error: "No se recibió imagen" }; break; }
            const material = d.material || "Plata 925";

            // Detectar tipo de imagen (jpeg por defecto)
            const mimeMatch = (d.imagen || "").match(/^data:(image\/[^;]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

            const promptGemini =
              `Eres el catalogador de una joyería fina latinoamericana de alto nivel. Tu misión es dar nombres EVOCADORES y SOFISTICADOS a cada pieza. Responde ÚNICAMENTE con JSON válido, sin texto antes ni después.\n\n` +
              `MATERIAL CONFIRMADO (no lo detectes, úsalo tal cual): ${material}\n\n` +
              `PASO 1 — TIPO de joya:\n` +
              `AN=anillo PU=pulsera CO=collar CD=collar+dije AR=aretes DJ=dije CJ=conjunto TB=tobillera RS=rosario CA=cadena\n\n` +
              `PASO 2 — Identifica con PRECISIÓN lo que ves:\n` +
              `• Motivo: corazón, lazo, mariposa, hoja, luna creciente, media luna, sol, estrella fugaz, serpiente, infinito, flor sakura, flor de lis, rosa, loto, trebol, cruz calada, ángel, querubín, elefante, llave antigua, corona, gota, ola, espiral, nudo celta, rombo calado, óvalo, solitario, pavé, baguette, banda, entrelazado, canasta, marquesa, gota invertida, pétalo, arco iris, pluma, hoja de olivo, vid, concha, estrella de mar, delfín, golondrina, colibri, abeja, libélula, cactus, palmera, montaña, ola marina\n` +
              `• Piedras: zirconia blanca, zirconia champagne, zirconia negra, zirconia azul zafiro, zirconia rojo rubí, zirconia verde esmeralda, zirconia morada amatista, zirconia rosa, ópalo sintético, perla cultivada, cristal, sin piedra\n` +
              `• Acabado: pulido espejo, acabado satinado, textura martillada, filigrana, calado, esmaltado blanco/negro/colorido, enchapado oro amarillo, enchapado oro rosa, bicolor plata-oro, micro pavé\n\n` +
              `VOCABULARIO SOFISTICADO para nombres — usa estas palabras cuando aplique:\n` +
              `solitario · pavé · calado · entrelazado · facetado · engastado · trenzado · apilable · abierto · minimalista · eterno · celestial · halo · vintage · art déco · baguette · marquesa · pétalo · canasta · banda · bisel · pronged · cluster · infinity · crepuscular · nacarado · tornasolado\n\n` +
              `REGLAS PARA EL NOMBRE:\n` +
              `- Formato: [Tipo] + [adjetivo sofisticado o motivo] + [detalle piedra si hay]\n` +
              `- Ejemplos BUENOS: "Anillo solitario zirconia oval", "Anillo pavé corazón", "Aretes luna creciente calada", "Collar mariposa nacarada", "Anillo entrelazado bicolor", "Anillo halo zirconia champagne"\n` +
              `- Ejemplos MALOS (PROHIBIDOS): "Anillo geométrico", "Anillo decorativo", "Anillo abstracto", "Anillo elegante", "Anillo moderno", "Anillo bonito", "Anillo con diseño"\n` +
              `- PROHIBIDO usar: geométrico, decorativo, abstracto, elegante, moderno, bonito, clásico, simple, diseño\n` +
              `- PRIMERA letra en MAYÚSCULA, el resto en minúsculas\n` +
              `- NO incluyas el material\n` +
              `- Máximo 5 palabras\n\n` +
              `REGLAS PARA DESCRIPCION:\n` +
              `- Específica: menciona el motivo exacto, tipo de piedra y acabado. Sin mencionar ${material}\n` +
              `- Máximo 12 palabras\n\n` +
              `REGLAS PARA DESCRIPCION_TIENDA:\n` +
              `- Frase poética de marketing: evoca emoción, sofisticación, ocasión de uso\n` +
              `- Ejemplos: "Delicado pavé que captura la luz en cada movimiento", "Luna creciente que ilumina tu elegancia natural"\n` +
              `- Máximo 18 palabras\n\n` +
              `Responde SOLO con este JSON:\n` +
              `{"categoria":"XX","nombre":"nombre sofisticado máx 5 palabras","descripcion":"descripción específica","descripcion_tienda":"frase poética de marketing"}`;

            // ── Usar Groq (gratis, llama-3.2-11b-vision) ─────────────────
            const groqKey = env.GROQ_KEY;
            if (!groqKey) { result = { ok: false, error: "GROQ_KEY no configurada en Cloudflare" }; break; }

            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [{
                  role: "user",
                  content: [
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                    { type: "text", text: promptGemini }
                  ]
                }],
                max_tokens: 400,
                temperature: 0.4
              })
            });

            if (!groqRes.ok) {
              const errTxt = await groqRes.text();
              result = { ok: false, error: "Groq error " + groqRes.status + ": " + errTxt.slice(0, 150) };
              break;
            }

            const groqData = await groqRes.json();
            const texto = (groqData.choices?.[0]?.message?.content || "").trim();
            const match = texto.match(/\{[\s\S]*?\}/);
            if (!match) { result = { ok: false, error: "Gemini no devolvió JSON: " + texto.slice(0, 150) }; break; }
            let parsed;
            try { parsed = JSON.parse(match[0]); }
            catch(pe) { result = { ok: false, error: "JSON inválido de Gemini: " + match[0].slice(0, 120) }; break; }

            result = { ok: true, resultado: {
              nombre:            parsed.nombre            || "",
              categoria:         parsed.categoria         || "",
              descripcion:       parsed.descripcion       || "",
              descripcion_tienda: parsed.descripcion_tienda || parsed.descripcion || "",
              material
            }};
          } catch(eIA) {
            result = { ok: false, error: "Error IA: " + eIA.message };
          }
          break;
        }

        case "GUARDAR_FOTO_PENDIENTE": {
          // Guarda URL de foto subida desde celular para usarla en el sistema
          const id = `foto_${Date.now()}`;
          await sb.set("fotos_pendientes", id, {
            id, url: d.url, fecha: new Date().toISOString(), usada: false
          });
          result = { ok: true, id };
          break;
        }

        case "GET_FOTOS_PENDIENTES": {
          if (!esAdmin) return forbidden();
          const fotos = await sb.getAll("fotos_pendientes");
          // Devolver solo las no usadas, más recientes primero, máx 20
          const recientes = fotos
            .filter(f => !f.usada)
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            .slice(0, 20);
          result = { ok: true, fotos: recientes };
          break;
        }

        case "MARCAR_FOTO_USADA": {
          if (!esAdmin) return forbidden();
          await sb.update("fotos_pendientes", d.id, { usada: true });
          result = { ok: true };
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
          result = { ok: false, error: `Acción no reconocida: ${d.accion}` };
      }

      return json(result);

    } catch(e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }
};

// ── CLASE SUPABASE ────────────────────────────────────────────────
//
//  Estructura de cada tabla en Supabase:
//    id   TEXT PRIMARY KEY   — el mismo "doc ID" que se usaba en Firestore
//    data JSONB              — todos los campos del documento
//
//  Función PostgreSQL requerida (ver SQL de setup):
//    update_doc(p_table, p_id, p_patch) — merge parcial de JSONB
// ─────────────────────────────────────────────────────────────────
class Supabase {
  constructor(url, key) {
    this.url = (url || "").replace(/\/$/, "");
    this.key = key || "";
  }

  _headers(prefer = null) {
    const h = {
      "apikey":        this.key,
      "Authorization": `Bearer ${this.key}`,
      "Content-Type":  "application/json"
    };
    if (prefer) h["Prefer"] = prefer;
    return h;
  }

  // Leer un documento por id
  async get(table, id) {
    const res  = await fetch(
      `${this.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`,
      { headers: this._headers() }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB get ${table}/${id}: ${res.status} ${txt}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { id: rows[0].id, ...rows[0].data };
  }

  // Obtener todos los documentos de una tabla
  async getAll(table) {
    const res  = await fetch(
      `${this.url}/rest/v1/${table}?select=id,data&limit=10000`,
      { headers: this._headers() }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB getAll ${table}: ${res.status} ${txt}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({ id: r.id, ...r.data }));
  }

  // Crear/sobreescribir documento (upsert completo)
  async set(table, id, obj) {
    const { id: _id, ...data } = obj;
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method:  "POST",
      headers: this._headers("resolution=merge-duplicates"),
      body:    JSON.stringify({ id, data })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB set ${table}: ${res.status} ${txt}`);
    }
  }

  // Actualizar campos específicos (merge parcial vía RPC)
  async update(table, id, fields) {
    const res = await fetch(`${this.url}/rest/v1/rpc/update_doc`, {
      method:  "POST",
      headers: this._headers(),
      body:    JSON.stringify({ p_table: table, p_id: String(id), p_patch: fields })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB update ${table}/${id}: ${res.status} ${txt}`);
    }
  }

  // Eliminar documento
  async delete(table, id) {
    const res = await fetch(
      `${this.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this._headers() }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB delete ${table}/${id}: ${res.status} ${txt}`);
    }
  }

  // Query con filtro sobre campo JSONB (campo == valor)
  async query(table, campo, _op, valor) {
    const res = await fetch(
      `${this.url}/rest/v1/${table}?select=id,data&data->>${encodeURIComponent(campo)}=eq.${encodeURIComponent(valor)}`,
      { headers: this._headers() }
    );
    if (!res.ok) {
      console.error(`[Supabase.query] Error ${res.status} en tabla ${table}`);
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({ id: r.id, ...r.data }));
  }
}

// ── AUTENTICACIÓN ────────────────────────────────────────────────
async function hashStr(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Verifica la contraseña: primero contra SECRET_PASS (env var),
// si no coincide intenta con el hash guardado en Supabase
// (permite cambiar contraseña sin editar el env var de Cloudflare).
async function verificarPassword(pass, env, sb) {
  if (!pass) return false;
  // Aceptar texto plano (SECRET_PASS del env) o su hash SHA-256
  if (pass === env.SECRET_PASS) return true;
  const hashDeSecret = await hashStr(env.SECRET_PASS || "");
  if (pass === hashDeSecret) return true;
  // También verificar contra passHash guardado en Supabase
  try {
    const cfg = await sb.get("config", "settings");
    if (cfg && cfg.passHash) {
      // Aceptar el hash directamente (frontend ya lo hasheó)
      if (pass === cfg.passHash) return true;
      // O hashear lo que llegó (compatibilidad con texto plano)
      const hash = await hashStr(pass);
      if (hash === cfg.passHash) return true;
    }
  } catch(_) {}
  return false;
}

// ── HELPERS HTTP ──────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function forbidden() {
  return json({ ok: false, error: "No autorizado" }, 403);
}
