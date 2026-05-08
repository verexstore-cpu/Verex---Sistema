// ═══════════════════════════════════════════════════════════════════
//  VEREX API — Cloudflare Worker con Supabase
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

export default {
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
          productos: prods.filter(p => p.estado !== "inactivo"),
          cupones:   cups.filter(c => c.activo !== false && c.activo !== "false"),
          config:    cfgDoc || {}
        });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    try {
      const d = await request.json();

      const esAdmin = (d._pass && d._pass === env.SECRET_PASS) ||
                      (d.key   && d.key   === env.SECRET_KEY);

      let result;

      switch (d.accion) {

        // ══ STOCK ════════════════════════════════════════════════
        case "STOCK_GET_ALL": {
          const docs = await sb.getAll("stock");
          result = { ok: true, stock: docs };
          break;
        }

        case "STOCK_REGISTRAR": {
          if (!esAdmin) return forbidden();
          const items = Array.isArray(d.items) ? d.items : [d];
          for (const item of items) {
            await sb.set("stock", item.codigo, item);
          }
          result = { ok: true };
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
          for (const item of (d.items || [])) {
            const doc = await sb.get("stock", item.codigo);
            if (doc) {
              await sb.update("stock", item.codigo, {
                stock_bodega:       item.stock_bodega       ?? doc.stock_bodega,
                stock_tienda:       item.stock_tienda       ?? doc.stock_tienda,
                stock_consignacion: item.stock_consignacion ?? doc.stock_consignacion,
              });
            }
          }
          result = { ok: true };
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
            id: corteId, vendedor: d.vendedor, fecha: d.fecha,
            totalVendido: d.totalVendido, comisionPct: d.comisionPct,
            gananciaVendedor: d.gananciaVendedor, aPagarVerex: d.aPagarVerex
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
              await sb.update("stock", item.codigo, {
                stock_bodega: Math.max(0, (parseInt(s.stock_bodega)||0) - (item.cantidad||1))
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
          await sb.update("pedidos", d.numeroPedido, { estado: d.estado });
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
          await sb.update("cupones", d.codigo, {
            usosActuales: (parseInt(cup.usosActuales)||0) + 1
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
          const prefijo = String(d.categoria || "GEN").toUpperCase().slice(0, 2);
          const allStock = await sb.getAll("stock");
          let maxNum = 0;
          allStock.forEach(s => {
            const base = String(s.codigoBase || "");
            if (base.startsWith(prefijo)) {
              const num = parseInt(base.replace(prefijo, "")) || 0;
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
          result = {
            ok: true,
            productos: prods.filter(p => p.estado !== "inactivo"),
            cupones:   cups.filter(c => c.activo !== false && c.activo !== "false"),
            config:    cfgDoc || {}
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
            await sb.update("clientes", codigoCliente, { totalPedidos: (parseInt(cliExist.totalPedidos)||0) + 1 });
          } else {
            codigoCliente = `CVX-${String(clientes.length + 1).padStart(3, "0")}`;
            await sb.set("clientes", codigoCliente, {
              codigo: codigoCliente, nombre: d.cliente, telefono: d.telefono,
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
            descMonto: d.descMonto || 0, envio: d.envio || 0
          });
          result = { ok: true, numeroPedido, codigoCliente };
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
          if (!vend) { result = { ok: false }; break; }
          result = {
            ok: String(vend.tokenInventario) === String(d.token),
            vendedor: vend
          };
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
            precio:             parseFloat(d.precio) || 0,
            foto:               d.img || "",
            descripcion:        d.caracteristicas || "",
            descripcionTienda:  d.caracteristicas || "",
            categoria:          d.categoria || "",
            talla:              "",
            stock_bodega:       parseInt(d.cantidad) || 0,
            stock_tienda:       0,
            stock_consignacion: 0,
            stock_vendido:      0,
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
          result = { ok: true, stock };
          break;
        }

        // ══ STOCK MOVIMIENTOS ════════════════════════════════════
        case "STOCK_ASIGNAR_TIENDA": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await sb.get("stock", codigo);
            if (s) {
              const cant = d.cantidad || 1;
              await sb.update("stock", codigo, {
                stock_bodega: Math.max(0, (parseInt(s.stock_bodega)||0) - cant),
                stock_tienda: (parseInt(s.stock_tienda)||0) + cant
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
              const cant = d.cantidad || 1;
              await sb.update("stock", codigo, {
                stock_bodega:       Math.max(0, (parseInt(s.stock_bodega)||0) - cant),
                stock_consignacion: (parseInt(s.stock_consignacion)||0) + cant
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
              const cant   = d.cantidad || 1;
              const origen = d.origen || "tienda";
              const updates = { stock_bodega: (parseInt(s.stock_bodega)||0) + cant };
              if (origen === "tienda")
                updates.stock_tienda        = Math.max(0, (parseInt(s.stock_tienda)||0) - cant);
              else if (origen === "consignacion")
                updates.stock_consignacion  = Math.max(0, (parseInt(s.stock_consignacion)||0) - cant);
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
          if (d.nombre      !== undefined) upd.nombre            = d.nombre;
          if (d.precio      !== undefined) upd.precio            = parseFloat(d.precio) || 0;
          if (d.img         !== undefined) upd.foto              = d.img;
          if (d.descripcion !== undefined) upd.descripcionTienda = d.descripcion;
          if (d.destacado   !== undefined) upd.destacado         = d.destacado;
          await sb.update("stock", d.codigo, upd);
          result = { ok: true };
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
        case "SUBIR_FOTO": {
          if (!esAdmin) return forbidden();
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
            const urlOptimizada = ikData.url + "?tr=w-600,q-85,f-webp,e-sharpen";
            result = { ok: true, url: urlOptimizada };
          } else {
            result = { ok: false, error: ikData.message || "Error subiendo foto" };
          }
          break;
        }

        case "ANALIZAR_IMAGEN": {
          if (!esAdmin) return forbidden();
          if (!env.AI) { result = { ok: false, error: "AI binding no configurado" }; break; }
          try {
            const base64 = (d.imagen || "").replace(/^data:image\/[^;]+;base64,/, "");
            if (!base64) { result = { ok: false, error: "No se recibió imagen" }; break; }
            const imageBytes = Array.from(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
            const material = d.material || "Plata 925";
            const prompt =
              `You are a professional jewelry analyst. Examine this jewelry photo VERY carefully and respond ONLY with a valid JSON object — no extra text, no markdown.\n\n` +
              `Analyze these details precisely:\n` +
              `1. TYPE: Is it a ring, bracelet, necklace, earrings, pendant/charm, or set?\n` +
              `2. SHAPE/DESIGN: heart, flower, cross, bow, star, wave, snake, geometric, plain/smooth, infinity, butterfly, etc.\n` +
              `3. STONES: zirconia, emerald, ruby, pearl, crystal, opal, or no stones?\n` +
              `4. COLORS/FINISH: shiny, matte, colorful enamel, multicolor, gold-plated, rose gold, bicolor?\n` +
              `5. SPECIAL DETAILS: engravings, texture, pattern, filigree, etc.\n\n` +
              `Material provided: ${material}\n\n` +
              `Categories: AN=anillo(ring) PU=pulsera(bracelet) CO=collar(necklace) AR=aretes(earrings) DJ=dije(pendant/charm) CJ=conjunto(set)\n\n` +
              `Respond ONLY with this JSON (name and description in SPANISH):\n` +
              `{"nombre":"descriptive Spanish name max 5 words e.g. Anillo ola bicolor esmaltado","categoria":"AN","descripcion":"brief Spanish description max 8 words"}`;
            const aiRes = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
              image: imageBytes, prompt, max_tokens: 200
            });
            const texto = (aiRes.description || aiRes.response || "").trim();
            const match = texto.match(/\{[\s\S]*?\}/);
            if (!match) { result = { ok: false, error: "IA: " + texto.slice(0, 100) }; break; }
            const parsed = JSON.parse(match[0]);
            result = { ok: true, resultado: {
              nombre:      parsed.nombre      || "",
              categoria:   parsed.categoria   || "",
              descripcion: parsed.descripcion || "",
              material
            }};
          } catch(eIA) {
            result = { ok: false, error: "Error IA: " + eIA.message };
          }
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
    const res  = await fetch(
      `${this.url}/rest/v1/${table}?select=id,data&data->>${encodeURIComponent(campo)}=eq.${encodeURIComponent(valor)}`,
      { headers: this._headers() }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({ id: r.id, ...r.data }));
  }
}

// ── HELPERS HTTP ──────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function forbidden() {
  return json({ ok: false, error: "No autorizado" }, 403);
}
