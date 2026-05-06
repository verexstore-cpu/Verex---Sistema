// ═══════════════════════════════════════════════════════════════════
//  VEREX API — Cloudflare Worker con Firebase Firestore
//  Proyecto: verex-sistema
//
//  SECRETS que debes configurar en Cloudflare (Settings → Variables → Secrets):
//    FIREBASE_SA_EMAIL    → client_email del Service Account
//    FIREBASE_SA_KEY      → private_key del Service Account (incluye -----BEGIN...-----)
//    SECRET_PASS          → contraseña del admin (la que usas hoy como _sessionPass)
// ═══════════════════════════════════════════════════════════════════

const PROJECT  = "verex-sistema";
const FS_BASE  = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── CORS ──────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json"
};

// ── ENTRADA ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("", { headers: CORS });

    // ── GET: catálogo público ──────────────────────────────────────
    if (request.method === "GET") {
      try {
        const token = await getFirestoreToken(env.FIREBASE_SA_EMAIL, env.FIREBASE_SA_KEY);
        const fs    = new Firestore(token, FS_BASE);
        const [prods, cups, cfgDoc] = await Promise.all([
          fs.getAll("stock"),
          fs.getAll("cupones"),
          fs.get("config", "settings"),
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

      // Autenticar admin (acciones que modifican datos)
      // Acepta _pass (admin panel) o key (inventario-sellers legacy)
      const esAdmin = (d._pass && d._pass === env.SECRET_PASS) ||
                      (d.key   && d.key   === env.SECRET_KEY);

      // Obtener token de Firestore
      const token = await getFirestoreToken(env.FIREBASE_SA_EMAIL, env.FIREBASE_SA_KEY);

      const fs = new Firestore(token, FS_BASE);
      let result;

      switch (d.accion) {

        // ══ STOCK ════════════════════════════════════════════════
        case "STOCK_GET_ALL": {
          const docs = await fs.getAll("stock");
          result = { ok: true, stock: docs };
          break;
        }

        case "STOCK_REGISTRAR": {
          if (!esAdmin) return forbidden();
          const items = Array.isArray(d.items) ? d.items : [d];
          for (const item of items) {
            await fs.set("stock", item.codigo, item);
          }
          result = { ok: true };
          break;
        }

        case "STOCK_ELIMINAR": {
          if (!esAdmin) return forbidden();
          await fs.delete("stock", d.codigo);
          result = { ok: true };
          break;
        }

        case "STOCK_ACTUALIZAR_CANTIDADES": {
          if (!esAdmin) return forbidden();
          for (const item of (d.items || [])) {
            const doc = await fs.get("stock", item.codigo);
            if (doc) {
              await fs.update("stock", item.codigo, {
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
          const docs = await fs.getAll("vendedores");
          result = { ok: true, vendedores: docs };
          break;
        }

        case "GUARDAR_VENDEDOR": {
          if (!esAdmin) return forbidden();
          await fs.set("vendedores", d.vendedor.codigo, d.vendedor);
          result = { ok: true };
          break;
        }

        case "ELIMINAR_VENDEDOR": {
          if (!esAdmin) return forbidden();
          await fs.delete("vendedores", d.codigo);
          result = { ok: true };
          break;
        }

        case "GUARDAR_TOKEN": {
          if (!esAdmin) return forbidden();
          await fs.update("vendedores", d.vendedor, { tokenInventario: d.token });
          result = { ok: true };
          break;
        }

        // ══ CONSIGNACION ══════════════════════════════════════════
        case "GET_CONSIGNACION": {
          const [cons, vends, stock] = await Promise.all([
            fs.getAll("consignacion"),
            fs.getAll("vendedores"),
            fs.getAll("stock"),
          ]);
          result = { ok: true, consignacion: cons, vendedores: vends, stock, productos: stock };
          break;
        }

        case "REGISTRAR_ENTREGA": {
          if (!esAdmin) return forbidden();
          const items = d.items || [];
          // Guardar cada item de consignacion
          for (const item of items) {
            const id = item.id || `CONS_${Date.now()}_${item.codigo}`;
            await fs.set("consignacion", id, {
              id, vendedor: d.vendedor, codigo: item.codigo,
              nombre: item.nombre, codigoBase: item.codigoBase || item.codigo,
              talla: item.talla || "", nombre_base: item.nombre_base || item.nombre,
              categoria: item.categoria || "", precio: item.precio || 0,
              cantidad: item.cantidad || 1, vendido: 0,
              foto: item.foto || "", fecha: new Date().toISOString(), estado: "activo"
            });
            // Descontar stock bodega
            const s = await fs.get("stock", item.codigo);
            if (s) {
              await fs.update("stock", item.codigo, {
                stock_bodega:       Math.max(0, (parseInt(s.stock_bodega)||0) - (item.cantidad||1)),
                stock_consignacion: (parseInt(s.stock_consignacion)||0) + (item.cantidad||1)
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "REGISTRAR_VENTA": {
          // Vendedor registra venta desde su link
          const cons = await fs.get("consignacion", d.id);
          if (!cons) { result = { ok: false, error: "Item no encontrado" }; break; }
          const nuevoVendido = (parseInt(cons.vendido)||0) + (parseInt(d.cantidad)||1);
          await fs.update("consignacion", d.id, { vendido: nuevoVendido });
          // Actualizar stock_vendido
          const s = await fs.get("stock", cons.codigo);
          if (s) {
            await fs.update("stock", cons.codigo, {
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
          // Guardar registro de devolución
          await fs.set("devoluciones", devId, {
            id: devId, vendedor: d.vendedor,
            fecha: new Date().toISOString(), items: JSON.stringify(items)
          });
          // Actualizar consignacion + stock
          for (const item of items) {
            const cons = await fs.get("consignacion", item.id);
            if (cons) {
              const nuevaCant = Math.max(0, (parseInt(cons.cantidad)||0) - (item.cantidad||1));
              await fs.update("consignacion", item.id, {
                cantidad: nuevaCant,
                estado: nuevaCant <= parseInt(cons.vendido||0) ? "devuelto" : "activo"
              });
            }
            // Devolver al stock bodega
            const s = await fs.get("stock", item.codigo);
            if (s) {
              await fs.update("stock", item.codigo, {
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
          await fs.delete("consignacion", d.id);
          result = { ok: true };
          break;
        }

        // ══ CORTES ════════════════════════════════════════════════
        case "CERRAR_CORTE": {
          if (!esAdmin) return forbidden();
          // Marcar devueltos
          for (const id of (d.devueltos || [])) {
            await fs.update("consignacion", id, { estado: "devuelto" });
          }
          // Resetear vendido a 0 en los activos del vendedor
          const allCons = await fs.query("consignacion", "vendedor", "==", d.vendedor);
          for (const c of allCons.filter(c => c.estado === "activo")) {
            await fs.update("consignacion", c.id, { vendido: 0 });
          }
          await fs.update("vendedores", d.vendedor, {
            totalVendido: 0,
            fechaCorte: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "GUARDAR_CORTE_HISTORIAL": {
          if (!esAdmin) return forbidden();
          const corteId = String(d.id);
          await fs.set("cortesHistorial", corteId, {
            id: corteId, vendedor: d.vendedor, fecha: d.fecha,
            totalVendido: d.totalVendido, comisionPct: d.comisionPct,
            gananciaVendedor: d.gananciaVendedor, aPagarVerex: d.aPagarVerex
          });
          result = { ok: true };
          break;
        }

        case "GET_HISTORIAL_CORTES": {
          const cortes = await fs.query("cortesHistorial", "vendedor", "==", d.vendedor);
          result = { ok: true, cortes };
          break;
        }

        // ══ VENTAS DIRECTAS ═══════════════════════════════════════
        case "REGISTRAR_VENTA_DIRECTA": {
          if (!esAdmin) return forbidden();
          const vdId = d.id || `VD_${Date.now()}`;
          await fs.set("ventas_directas", vdId, {
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
          // Descontar stock
          for (const item of (d.items || [])) {
            const s = await fs.get("stock", item.codigo);
            if (s) {
              await fs.update("stock", item.codigo, {
                stock_bodega: Math.max(0, (parseInt(s.stock_bodega)||0) - (item.cantidad||1))
              });
            }
          }
          result = { ok: true };
          break;
        }

        case "GET_VENTAS_DIRECTAS": {
          if (!esAdmin) return forbidden();
          let ventas = await fs.getAll("ventas_directas");
          if (d.estado) ventas = ventas.filter(v => v.estado === d.estado);
          ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
          result = { ok: true, ventas };
          break;
        }

        case "REGISTRAR_ABONO": {
          if (!esAdmin) return forbidden();
          const abonoId = `AB_${Date.now()}`;
          await fs.set("abonos", abonoId, {
            id: abonoId, ventaId: d.ventaId,
            fecha: new Date().toISOString(), monto: d.monto || 0
          });
          const vd = await fs.get("ventas_directas", d.ventaId);
          if (vd) {
            const nuevoSaldo = Math.max(0, (parseFloat(vd.saldoPendiente)||0) - (d.monto||0));
            await fs.update("ventas_directas", d.ventaId, {
              saldoPendiente: nuevoSaldo,
              estado: nuevoSaldo <= 0 ? "pagado" : "credito"
            });
          }
          result = { ok: true };
          break;
        }

        case "GET_ABONOS_VENTA": {
          if (!esAdmin) return forbidden();
          const abonos = await fs.query("abonos", "ventaId", "==", d.ventaId);
          result = { ok: true, abonos };
          break;
        }

        case "REGISTRAR_VENTA_VENDEDOR": {
          // Alias desde inventario-sellers
          const consV = await fs.get("consignacion", d.id);
          if (!consV) { result = { ok: false, error: "Item no encontrado" }; break; }
          const nuevoVendidoV = (parseInt(consV.vendido)||0) + (parseInt(d.cantidad)||1);
          await fs.update("consignacion", d.id, { vendido: nuevoVendidoV });
          const sV = await fs.get("stock", consV.codigo);
          if (sV) {
            await fs.update("stock", consV.codigo, {
              stock_vendido: (parseInt(sV.stock_vendido)||0) + (parseInt(d.cantidad)||1)
            });
          }
          result = { ok: true, ventaId: d.id };
          break;
        }

        case "GET_VENTAS_VENDEDOR": {
          const ventasV = await fs.query("consignacion", "vendedor", "==", d.vendedor);
          result = { ok: true, ventas: ventasV.filter(v => parseInt(v.vendido) > 0) };
          break;
        }

        case "SOLICITAR_CORRECCION_VENTA": {
          const solId = `SOL_${Date.now()}`;
          await fs.set("solicitudes_correccion", solId, {
            id: solId, ventaId: d.ventaId || "",
            vendedor: d.vendedor || "", motivo: d.motivo || "",
            codigo: d.codigo || "", estado: "pendiente",
            fecha: new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "GET_DEVOLUCIONES_VENDEDOR": {
          const devs = await fs.query("devoluciones", "vendedor", "==", d.vendedor);
          result = { ok: true, devoluciones: devs };
          break;
        }

        // ══ PEDIDOS TIENDA ════════════════════════════════════════
        case "GUARDAR_PEDIDO": {
          const pedidoId = d.numeroPedido || `PED_${Date.now()}`;
          await fs.set("pedidos", pedidoId, { ...d, id: pedidoId });
          result = { ok: true, numeroPedido: pedidoId };
          break;
        }

        case "GET_PEDIDOS": {
          if (!esAdmin) return forbidden();
          const pedidos = await fs.getAll("pedidos");
          result = { ok: true, pedidos };
          break;
        }

        case "ACTUALIZAR_ESTADO_PEDIDO": {
          if (!esAdmin) return forbidden();
          await fs.update("pedidos", d.numeroPedido, { estado: d.estado });
          result = { ok: true };
          break;
        }

        // ══ CLIENTES ══════════════════════════════════════════════
        case "GET_CLIENTES": {
          if (!esAdmin) return forbidden();
          const clientes = await fs.getAll("clientes");
          result = { ok: true, clientes };
          break;
        }

        case "GUARDAR_CLIENTE": {
          await fs.set("clientes", d.codigo || `CLI_${Date.now()}`, d);
          result = { ok: true };
          break;
        }

        // ══ CUPONES ═══════════════════════════════════════════════
        case "USAR_CUPON": {
          const cup = await fs.get("cupones", d.codigo);
          if (!cup) { result = { ok: false, error: "Cupón no encontrado" }; break; }
          await fs.update("cupones", d.codigo, {
            usosActuales: (parseInt(cup.usosActuales)||0) + 1
          });
          result = { ok: true };
          break;
        }

        // ══ CONFIG ════════════════════════════════════════════════
        case "GET_CONFIG": {
          const cfg = await fs.get("config", "settings");
          result = { ok: true, config: cfg || {} };
          break;
        }

        case "GUARDAR_CONFIG": {
          if (!esAdmin) return forbidden();
          await fs.update("config", "settings", d.config || {});
          result = { ok: true };
          break;
        }

        // ══ GENERAR CÓDIGO ════════════════════════════════════════
        case "GENERAR_CODIGO": {
          const prefijo = String(d.categoria || "GEN").toUpperCase().slice(0, 2);
          const allStock = await fs.getAll("stock");
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
            fs.getAll("stock"),
            fs.getAll("cupones"),
            fs.get("config", "settings"),
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
          // Generar número de pedido #10DDMM-001
          const now    = new Date();
          const dd     = String(now.getDate()).padStart(2, "0");
          const mm     = String(now.getMonth() + 1).padStart(2, "0");
          const prefijo = `#10${dd}${mm}`;
          const todosLosPedidos = await fs.getAll("pedidos");
          const hoyStr = now.toISOString().slice(0, 10);
          const correl = todosLosPedidos.filter(p => (p.fecha || "").slice(0, 10) === hoyStr).length + 1;
          const numeroPedido = `${prefijo}-${String(correl).padStart(3, "0")}`;
          // Crear o actualizar cliente
          const clientes = await fs.getAll("clientes");
          const cliExist = clientes.find(c => String(c.telefono) === String(d.telefono));
          let codigoCliente = "";
          if (cliExist) {
            codigoCliente = cliExist.codigo;
            await fs.update("clientes", codigoCliente, { totalPedidos: (parseInt(cliExist.totalPedidos)||0) + 1 });
          } else {
            codigoCliente = `CVX-${String(clientes.length + 1).padStart(3, "0")}`;
            await fs.set("clientes", codigoCliente, {
              codigo: codigoCliente, nombre: d.cliente, telefono: d.telefono,
              municipio: d.municipio || "", direccion: d.direccion || "",
              departamento: d.departamento || "", totalPedidos: 1,
              fechaRegistro: new Date().toISOString()
            });
          }
          // Guardar pedido
          await fs.set("pedidos", numeroPedido, {
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
          const cliAll = await fs.getAll("clientes");
          const cli = cliAll.find(c =>
            String(c.codigo) === String(d.codigo) ||
            String(c.telefono) === String(d.codigo)
          );
          result = cli ? { ok: true, cliente: cli } : { ok: false };
          break;
        }

        case "VERIFICAR_TOKEN": {
          const vend = await fs.get("vendedores", d.vendedor);
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
            fs.getAll("stock"),
            fs.getAll("pedidos"),
            fs.getAll("cupones"),
            fs.getAll("clientes"),
            fs.get("config", "settings"),
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
          await fs.set("stock", prodId, {
            codigo:            prodId,
            codigoBase:        prodId,
            nombre:            d.nombre || "",
            precio:            parseFloat(d.precio) || 0,
            foto:              d.img || "",
            descripcion:       d.caracteristicas || "",
            descripcionTienda: d.caracteristicas || "",
            categoria:         d.categoria || "",
            talla:             "",
            stock_bodega:      parseInt(d.cantidad) || 0,
            stock_tienda:      0,
            stock_consignacion:0,
            stock_vendido:     0,
            estado:            "activo",
            fechaRegistro:     new Date().toISOString()
          });
          result = { ok: true };
          break;
        }

        case "ELIMINAR_PEDIDO": {
          if (!esAdmin) return forbidden();
          await fs.delete("pedidos", d.numeroPedido);
          result = { ok: true };
          break;
        }

        // ══ ALIAS ════════════════════════════════════════════════
        case "GET_STOCK": {
          const stock = await fs.getAll("stock");
          result = { ok: true, stock };
          break;
        }

        // ══ STOCK MOVIMIENTOS ════════════════════════════════════
        case "STOCK_ASIGNAR_TIENDA": {
          if (!esAdmin) return forbidden();
          for (const codigo of (d.codigos || [])) {
            const s = await fs.get("stock", codigo);
            if (s) {
              const cant = d.cantidad || 1;
              await fs.update("stock", codigo, {
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
            const s = await fs.get("stock", codigo);
            if (s) {
              const cant = d.cantidad || 1;
              await fs.update("stock", codigo, {
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
            const s = await fs.get("stock", codigo);
            if (s) {
              const cant   = d.cantidad || 1;
              const origen = d.origen || "tienda";
              const updates = { stock_bodega: (parseInt(s.stock_bodega)||0) + cant };
              if (origen === "tienda")        updates.stock_tienda        = Math.max(0, (parseInt(s.stock_tienda)||0) - cant);
              else if (origen === "consignacion") updates.stock_consignacion = Math.max(0, (parseInt(s.stock_consignacion)||0) - cant);
              await fs.update("stock", codigo, updates);
            }
          }
          result = { ok: true };
          break;
        }

        // ══ PRODUCTOS (stock items) ═══════════════════════════════
        case "EDITAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          const upd = {};
          if (d.nombre      !== undefined) upd.nombre            = d.nombre;
          if (d.precio      !== undefined) upd.precio            = parseFloat(d.precio) || 0;
          if (d.img         !== undefined) upd.foto              = d.img;
          if (d.descripcion !== undefined) upd.descripcionTienda = d.descripcion;
          if (d.destacado   !== undefined) upd.destacado         = d.destacado;
          await fs.update("stock", d.codigo, upd);
          result = { ok: true };
          break;
        }

        case "ELIMINAR_PRODUCTO": {
          if (!esAdmin) return forbidden();
          await fs.update("stock", d.codigo, { estado: "inactivo" });
          result = { ok: true };
          break;
        }

        // ══ ENTREGAS PENDIENTES ════════════════════════════════════
        case "REGISTRAR_ENTREGA_PENDIENTE": {
          if (!esAdmin) return forbidden();
          const entId = d.id || `ENT_${Date.now()}`;
          await fs.set("entregas", entId, {
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
          const ents = await fs.query("entregas", "vendedor", "==", d.vendedor);
          const entsFilt = ents.filter(e => e.estado === "pendiente");
          result = { ok: true, entregas: entsFilt };
          break;
        }

        case "GET_ENTREGAS_CONFIRMADAS": {
          if (!esAdmin) return forbidden();
          let allEnts;
          try { allEnts = await fs.getAll("entregas"); } catch(_) { allEnts = []; }
          result = { ok: true, entregas: allEnts.filter(e => e.estado === "confirmado") };
          break;
        }

        case "CONFIRMAR_ENTREGA_RECIBO": {
          const entDoc = await fs.get("entregas", d.id);
          if (!entDoc) { result = { ok: false, error: "Entrega no encontrada" }; break; }
          const esperado  = String(entDoc.codigoRecibo || "").toUpperCase();
          const ingresado = String(d.codigoRecibo || "").toUpperCase();
          if (esperado && esperado !== ingresado) { result = { ok: false, error: "Código de recibo incorrecto" }; break; }
          await fs.update("entregas", d.id, { estado: "confirmado", fechaConfirmacion: new Date().toISOString() });
          result = { ok: true };
          break;
        }

        // ══ SOLICITUDES DE CORRECCIÓN ═════════════════════════════
        case "GET_SOLICITUDES_CORRECCION": {
          if (!esAdmin) return forbidden();
          let sols;
          try { sols = await fs.query("solicitudes_correccion", "estado", "==", "pendiente"); }
          catch(_) { sols = []; }
          result = { ok: true, solicitudes: sols };
          break;
        }

        case "APROBAR_CORRECCION_VENTA": {
          if (!esAdmin) return forbidden();
          await fs.update("solicitudes_correccion", String(d.id), { estado: "aprobado" });
          result = { ok: true };
          break;
        }

        case "RECHAZAR_CORRECCION_VENTA": {
          if (!esAdmin) return forbidden();
          await fs.update("solicitudes_correccion", String(d.id), { estado: "rechazado" });
          result = { ok: true };
          break;
        }

        // ══ CONFIG / PASS ═════════════════════════════════════════
        case "ACTUALIZAR_PASS_HASH": {
          if (!esAdmin) return forbidden();
          await fs.update("config", "settings", { passHash: d.nuevoHash });
          result = { ok: true };
          break;
        }

        case "ACTUALIZAR_CONFIG": {
          if (!esAdmin) return forbidden();
          await fs.update("config", "settings", d.config || {});
          result = { ok: true };
          break;
        }

        // ══ CUPONES ═══════════════════════════════════════════════
        case "CREAR_CUPON": {
          if (!esAdmin) return forbidden();
          await fs.set("cupones", d.codigo, {
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
          await fs.update("cupones", d.codigo, { activo: !!d.activo });
          result = { ok: true };
          break;
        }

        case "ELIMINAR_CUPON": {
          if (!esAdmin) return forbidden();
          await fs.delete("cupones", d.codigo);
          result = { ok: true };
          break;
        }

        // ══ IMAGEN / FOTO (servicios externos no disponibles) ════
        case "SUBIR_FOTO": {
          if (!esAdmin) return forbidden();
          const ikKey = env.IMAGEKIT_PRIVATE_KEY;
          if (!ikKey) { result = { ok: false, error: "ImageKit no configurado en secrets" }; break; }
          const authHeader = "Basic " + btoa(ikKey + ":");
          const ext        = (d.imagen || "").startsWith("data:image/png") ? "png" : "jpg";
          const fileName   = (d.nombre || ("foto_" + Date.now())) + "." + ext;
          const form       = new FormData();
          form.append("file",     d.imagen);   // base64 con o sin prefijo data:
          form.append("fileName", fileName);
          form.append("folder",   "/consignacion");
          form.append("useUniqueFileName", "true");
          const ikRes  = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
            method: "POST",
            headers: { "Authorization": authHeader },
            body:   form
          });
          const ikData = await ikRes.json();
          if (ikData.url) {
            result = { ok: true, url: ikData.url };
          } else {
            result = { ok: false, error: ikData.message || "Error subiendo foto a ImageKit" };
          }
          break;
        }

        case "ANALIZAR_IMAGEN": {
          result = { ok: false, error: "Análisis de imagen no disponible." };
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

// ── CLASE FIRESTORE ───────────────────────────────────────────────
class Firestore {
  constructor(token, base) {
    this.token = token;
    this.base  = base;
  }

  headers() {
    return { "Authorization": `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  // Leer un documento por ID
  async get(col, id) {
    const res = await fetch(`${this.base}/${col}/${encodeURIComponent(id)}`, { headers: this.headers() });
    if (res.status === 404) return null;
    const data = await res.json();
    return data.fields ? fieldsToObj(data.fields) : null;
  }

  // Crear/sobreescribir documento
  async set(col, id, obj) {
    const url = `${this.base}/${col}/${encodeURIComponent(id)}`;
    await fetch(url, {
      method:  "PATCH",
      headers: this.headers(),
      body:    JSON.stringify({ fields: objToFields(obj) })
    });
  }

  // Actualizar campos específicos
  async update(col, id, fields) {
    const keys    = Object.keys(fields);
    const mask    = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const url     = `${this.base}/${col}/${encodeURIComponent(id)}?${mask}`;
    await fetch(url, {
      method:  "PATCH",
      headers: this.headers(),
      body:    JSON.stringify({ fields: objToFields(fields) })
    });
  }

  // Eliminar documento
  async delete(col, id) {
    await fetch(`${this.base}/${col}/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: this.headers()
    });
  }

  // Obtener todos los documentos de una colección
  async getAll(col) {
    const res  = await fetch(`${this.base}/${col}`, { headers: this.headers() });
    const data = await res.json();
    return (data.documents || []).map(doc => fieldsToObj(doc.fields));
  }

  // Query simple (un campo == valor)
  async query(col, campo, op, valor) {
    const body = {
      structuredQuery: {
        from:  [{ collectionId: col }],
        where: {
          fieldFilter: {
            field: { fieldPath: campo },
            op:    op === "==" ? "EQUAL" : op,
            value: toFirestoreValue(valor)
          }
        }
      }
    };
    const url  = `${this.base}:runQuery`;
    const res  = await fetch(url, {
      method:  "POST",
      headers: this.headers(),
      body:    JSON.stringify(body)
    });
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .filter(r => r.document)
      .map(r => ({ ...fieldsToObj(r.document.fields), id: r.document.name.split("/").pop() }));
  }
}

// ── CONVERSIÓN FIRESTORE ↔ JS ─────────────────────────────────────
function objToFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k && v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean")        return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (typeof v === "object")         return { stringValue: JSON.stringify(v) };
  // String que parece número entero
  if (!isNaN(v) && v.trim() !== "" && Number.isInteger(parseFloat(v)) && !v.includes("."))
    return { integerValue: v.trim() };
  if (!isNaN(v) && v.trim() !== "")
    return { doubleValue: parseFloat(v) };
  return { stringValue: String(v) };
}

function fieldsToObj(fields) {
  if (!fields) return {};
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if      ("stringValue"    in v) obj[k] = v.stringValue;
    else if ("integerValue"   in v) obj[k] = parseInt(v.integerValue);
    else if ("doubleValue"    in v) obj[k] = v.doubleValue;
    else if ("booleanValue"   in v) obj[k] = v.booleanValue;
    else if ("timestampValue" in v) obj[k] = v.timestampValue;
    else if ("nullValue"      in v) obj[k] = null;
    else                            obj[k] = JSON.stringify(v);
  }
  return obj;
}

// ── AUTH: Service Account → Access Token ──────────────────────────
async function getFirestoreToken(saEmail, saKey) {
  const now     = Math.floor(Date.now() / 1000);
  const payload = {
    iss: saEmail,
    sub: saEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore"
  };

  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body    = b64url(JSON.stringify(payload));
  const signing = `${header}.${body}`;

  // Importar clave privada PEM (maneja comillas, \n literales y newlines reales)
  let pem = saKey.trim();
  pem = pem.replace(/^["']|["']$/g, "");   // quitar comillas envolventes
  pem = pem.replace(/\\n/g, "\n");          // \n literal → salto de línea
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");                   // quitar todo espacio/newline
  const keyBytes  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(signing)
  );
  const jwt = `${signing}.${b64url(sig)}`;

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body:   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("No se pudo obtener token Firebase: " + JSON.stringify(data));
  return data.access_token;
}

function b64url(data) {
  const str = typeof data === "string"
    ? data
    : String.fromCharCode(...new Uint8Array(data));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── HELPERS HTTP ───────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function forbidden() {
  return json({ ok: false, error: "No autorizado" }, 403);
}
