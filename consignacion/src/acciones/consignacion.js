// Consignación: entregas, ventas y devoluciones del vendedor, cortes
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { pinIncorrecto } from "../lib/auth.js";
import { NO_MANEJADA, forbidden, json } from "../lib/http.js";
import { sanearConfigPublico } from "../lib/publico.js";
import { safeEq } from "../lib/seguridad.js";
import { registrarDevolucionEnBloque, registrarEntregaEnBloque } from "../lib/stock-bloque.js";
import { RE_FECHA_CORTE, validarVendedorToken } from "../lib/vendedores.js";

export async function accionesConsignacion({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "GET_CONSIGNACION": {
      if (!esAdmin) return forbidden();
      const [cons, vends, stock, cfgCons] = await Promise.all([
        sb.getAll("consignacion"),
        sb.getAll("vendedores"),
        sb.getAll("stock"),
        sb.get("config", "settings"),
      ]);
      // sanearConfigPublico quita passHash/otp/ssoTokens — Consignación solo
      // necesita leer cfg.promoGeneral (para ofrecerla en Venta Directa), nunca
      // credenciales del login de Admin.
      result = { ok: true, consignacion: cons, vendedores: vends, stock, productos: stock, config: sanearConfigPublico(cfgCons) };
      break;
    }

    // Público (validado por token+PIN, igual que VERIFICAR_TOKEN) — el
    // inventario del vendedor necesita ver SU propio consignacion sin
    // tener contraseña de admin. Solo devuelve lo de ese vendedor, nunca
    // el dataset completo de todos los vendedores.
    case "GET_INVENTARIO_VENDEDOR": {
      if (!d.vendedor || !d.token) return json({ ok: false, error: "vendedor y token requeridos" });
      const vendInv = await sb.get("vendedores", d.vendedor);
      if (!vendInv || !vendInv.tokenInventario || !safeEq(vendInv.tokenInventario, d.token)) {
        return json({ ok: false, error: "Token inválido" });
      }
      if (await pinIncorrecto(sb, vendInv, d.pin, d.vendedor)) {
        return json({ ok: false, error: "PIN incorrecto" });
      }
      const consV2 = await sb.query("consignacion", "vendedor", "==", d.vendedor);
      // Se enriquece cada item con si VEREX todavía tiene piezas en
      // bodega — así el inventario del vendedor puede seguir ofreciendo
      // (y vendiendo "bajo pedido") una pieza aunque él ya no tenga
      // ninguna físicamente, en vez de perder la venta.
      const todoStockInv = await sb.getAll("stock");
      const stockMapInv = new Map(todoStockInv.map(s => [String(s.codigo||"").toUpperCase(), s]));
      // Mismo agrupado por codigoBase que GET_CODIGOS_VENDEDOR — si la
      // talla exacta se agotó pero hay otra talla del mismo modelo en
      // bodega, se avisa cuál en vez de solo ocultar la pieza.
      const stockPorBaseInv = new Map();
      for (const s of todoStockInv) {
        const base = String(s.codigoBase || s.codigo || "").toUpperCase();
        if (!base) continue;
        if (!stockPorBaseInv.has(base)) stockPorBaseInv.set(base, []);
        stockPorBaseInv.get(base).push(s);
      }
      const consV2Enriquecido = consV2.map(c => {
        const sInv = stockMapInv.get(String(c.codigo||"").toUpperCase()) || {};
        const restanteInv = Math.max(0, (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0));
        const bajoPedidoInv = restanteInv <= 0 && (parseInt(sInv.stock_bodega)||0) > 0;
        let tallasDisponiblesInv = [];
        if (restanteInv <= 0 && !bajoPedidoInv) {
          const baseC = String(c.codigoBase || (c.codigo||"").replace(/-\d+$/, "") || "").toUpperCase();
          const codC = String(c.codigo||"").toUpperCase();
          tallasDisponiblesInv = [...new Set(
            (stockPorBaseInv.get(baseC) || [])
              .filter(sib => String(sib.codigo||"").toUpperCase() !== codC && (parseInt(sib.stock_bodega)||0) > 0)
              .map(sib => sib.talla).filter(Boolean)
          )];
        }
        return { ...c, bajoPedido: bajoPedidoInv, tallasDisponibles: tallasDisponiblesInv };
      });
      result = { ok: true, consignacion: consV2Enriquecido };
      break;
    }

    case "GET_CODIGOS_FISICOS": {
      // Retorna los códigos de productos activos en consignación para un vendedor híbrido
      if (!esAdmin) return forbidden();
      if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
      const todaCons = await sb.getAll("consignacion");
      const codigos = todaCons
        .filter(c => c.vendedor === d.vendedor && c.estado === "activo" && (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0) > 0)
        .map(c => c.codigo);
      result = { ok: true, codigos };
      break;
    }

    case "GET_CODIGOS_VENDEDOR": {
      // Endpoint público: devuelve los productos que un vendedor tiene
      // en consignación activa, con TODOS los datos que el catálogo
      // necesita para mostrarlos (foto, precio, nombre, etc.) — el
      // catálogo del vendedor NO depende de la curación "enCatalogo"
      // de la tienda general (esas son cosas distintas: lo que él
      // tiene físicamente vs. lo que se destaca en verexstore.com).
      if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
      const [todaCons, todoStock] = await Promise.all([
        sb.getAll("consignacion"),
        sb.getAll("stock"),
      ]);
      const stockPorCodigo = new Map(todoStock.map(s => [String(s.codigo || "").toUpperCase(), s]));
      // Para avisar "disponible en otras tallas": agrupar TODO el stock
      // por codigoBase (el mismo modelo, sin importar la talla) — así
      // cuando la talla exacta que tenía el vendedor se agota, se puede
      // saber qué otras tallas de ESE modelo sí hay en bodega, en vez de
      // solo decir "bajo pedido" (que implica que llega la MISMA talla).
      const stockPorBase = new Map();
      for (const s of todoStock) {
        const base = String(s.codigoBase || s.codigo || "").toUpperCase();
        if (!base) continue;
        if (!stockPorBase.has(base)) stockPorBase.set(base, []);
        stockPorBase.get(base).push(s);
      }
      const tallasHermanasDisponibles = c => {
        const baseC = String(c.codigoBase || (c.codigo||"").replace(/-\d+$/, "") || "").toUpperCase();
        const codC = String(c.codigo||"").toUpperCase();
        return [...new Set(
          (stockPorBase.get(baseC) || [])
            .filter(sib => String(sib.codigo||"").toUpperCase() !== codC && (parseInt(sib.stock_bodega)||0) > 0)
            .map(sib => sib.talla).filter(Boolean)
        )];
      };
      // Se incluyen también los items en 0 con el vendedor SIEMPRE que
      // VEREX todavía tenga piezas en bodega para reponerle (misma talla)
      // o en otra talla del mismo modelo — así el catálogo no oculta la
      // pieza ni el vendedor pierde la venta, solo se marca "bajoPedido"
      // o "tallasDisponibles" para que el catálogo lo avise al cliente.
      const itemsVendedor = todaCons.filter(c => {
        if (c.vendedor !== d.vendedor || c.estado !== "activo") return false;
        const restante = (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0);
        if (restante > 0) return true;
        const sBod = stockPorCodigo.get(String(c.codigo || "").toUpperCase());
        if ((parseInt(sBod?.stock_bodega)||0) > 0) return true;
        return tallasHermanasDisponibles(c).length > 0;
      });
      const productos = itemsVendedor.map(c => {
        const s = stockPorCodigo.get(String(c.codigo || "").toUpperCase()) || {};
        const restante = Math.max(0, (parseInt(c.cantidad)||0) - (parseInt(c.vendido)||0));
        const bajoPedido = restante <= 0 && (parseInt(s.stock_bodega)||0) > 0;
        const tallasDisponibles = (restante <= 0 && !bajoPedido) ? tallasHermanasDisponibles(c) : [];
        return {
          codigo: c.codigo, codigoBase: c.codigoBase || (c.codigo||"").replace(/-\d+$/, ""),
          nombre: c.nombre || s.nombre || "", nombre_base: c.nombre_base || s.nombre_base || c.nombre || "",
          precio: c.precio || s.precio || 0, foto: c.foto || s.foto || "",
          categoria: c.categoria || s.categoria || "", talla: c.talla || s.talla || "",
          descripcion: s.descripcion || "", material: s.material || "",
          stock_bodega: restante,
          bajoPedido,
          tallasDisponibles,
        };
      });
      const codigos = [...new Set(productos.map(p => p.codigoBase.toUpperCase()).filter(Boolean))];
      result = { ok: true, codigos, productos };
      break;
    }

    case "REGISTRAR_ENTREGA": {
      if (!esAdmin) return forbidden();
      result = await registrarEntregaEnBloque(sb, d);
      break;
    }

    case "FINALIZAR_ENTREGA_VENDEDOR": {
      // Publica de una vez todos los borradores acumulados de un vendedor:
      // estado "borrador" → "activo". A partir de aquí aparecen en su link.
      if (!esAdmin) return forbidden();
      if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
      const todaCons = await sb.getAll("consignacion");
      const borradores = todaCons.filter(c => c.vendedor === d.vendedor && c.estado === "borrador");
      // A prueba de fallos: si un item falla a mitad del lote, los demás
      // se siguen publicando en vez de quedar todos atascados en borrador
      // (eso obligaba a firmar dos veces — una por cada intento parcial).
      const publicadosIds = [];
      const fallidosPub = [];
      for (const c of borradores) {
        try {
          await sb.update("consignacion", c.id, { estado: "activo" });
          publicadosIds.push(c.id);
        } catch (errPub) {
          fallidosPub.push({ id: c.id, codigo: c.codigo, error: errPub.message || String(errPub) });
        }
      }
      result = { ok: fallidosPub.length === 0, publicados: publicadosIds.length, publicadosIds, fallidos: fallidosPub };
      break;
    }

    case "BORRAR_BORRADORES_VENDEDOR": {
      // Borra TODOS los borradores pendientes (sin publicar) de un vendedor
      // y restaura el stock de cada pieza a bodega — para empezar de cero
      // sin dejar stock "atrapado" en registros a medio armar.
      if (!esAdmin) return forbidden();
      if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
      const todaCons = await sb.getAll("consignacion");
      const borradores = todaCons.filter(c => c.vendedor === d.vendedor && c.estado === "borrador");
      let restaurados = 0;
      for (const item of borradores) {
        try {
          const cantRestaurar = Math.max(0, (parseInt(item.cantidad)||0) - (parseInt(item.vendido)||0));
          if (cantRestaurar > 0) {
            const prodStock = await sb.get("stock", item.codigo);
            if (prodStock) {
              await sb.update("stock", item.codigo, {
                stock_consignacion: Math.max(0, (parseInt(prodStock.stock_consignacion)||0) - cantRestaurar),
                stock_bodega: (parseInt(prodStock.stock_bodega)||0) + cantRestaurar
              });
            }
          }
          await sb.delete("consignacion", item.id);
          restaurados++;
        } catch (errItem) { /* seguir con los demás aunque uno falle */ }
      }
      result = { ok: true, eliminados: restaurados };
      break;
    }

    case "GET_BORRADORES_VENDEDOR": {
      if (!esAdmin) return forbidden();
      if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
      const todaCons = await sb.getAll("consignacion");
      const borradores = todaCons.filter(c => c.vendedor === d.vendedor && c.estado === "borrador");
      result = { ok: true, borradores };
      break;
    }

    case "REGISTRAR_VENTA": {
      if (!esAdmin) return forbidden();
      const cons = await sb.get("consignacion", d.id);
      if (!cons) { result = { ok: false, error: "Item no encontrado" }; break; }
      const cantVentaAdmin = parseInt(d.cantidad) || 1;
      const nuevoVendido = (parseInt(cons.vendido)||0) + cantVentaAdmin;
      // estado:"activo" siempre — renderPerfilStats()/abrirCorte() calculan
      // "Vendidos" y la comisión pendiente filtrando SOLO estado:"activo";
      // el único lugar que debe pasar un item a estado:"vendido" es
      // CERRAR_CORTE, al liquidarlo. Si este registro venía de recuperar
      // una venta cerrada por error con "Ya vendida" (estado quedaba en
      // "vendido"), sin esto la venta quedaba bien contada en el reporte
      // pero invisible en el stock/comisión en vivo del vendedor hasta el
      // próximo corte, sin ninguna forma de notarlo.
      await sb.update("consignacion", d.id, { vendido: nuevoVendido, estado: "activo" });
      const s = await sb.get("stock", cons.codigo);
      if (s) {
        await sb.update("stock", cons.codigo, {
          stock_vendido:      (parseInt(s.stock_vendido)||0) + cantVentaAdmin,
          stock_consignacion: Math.max(0, (parseInt(s.stock_consignacion)||0) - cantVentaAdmin)
        });
      }
      // Igual que REGISTRAR_VENTA_VENDEDOR: se guarda un registro individual
      // de la venta con su fecha real — acepta d.fecha para ventas que se
      // registran tarde (el admin se entera después de que ya pasaron) y
      // así no queden fuera del cierre del mes en que de verdad ocurrieron.
      const fechaVentaAdmin = d.fecha ? new Date(d.fecha).toISOString() : new Date().toISOString();
      const vendVA = await sb.get("vendedores", cons.vendedor);
      if (vendVA) {
        const historialVA = Array.isArray(vendVA.historialVentas) ? vendVA.historialVentas : [];
        historialVA.push({
          id: `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, consignacionId: d.id,
          codigo: cons.codigo, nombre: cons.nombre || "",
          precio: cons.precio || 0, foto: cons.foto || "",
          cantidad: cantVentaAdmin, fecha: fechaVentaAdmin,
          registradaPorAdmin: true
        });
        await sb.update("vendedores", cons.vendedor, { historialVentas: historialVA });
      }
      result = { ok: true };
      break;
    }

    case "REGISTRAR_DEVOLUCION": {
      if (!esAdmin) return forbidden();
      result = await registrarDevolucionEnBloque(sb, d);
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

    // Cierra un item que en realidad YA se vendió (típicamente uno que
    // quedó mal cerrado por el bug de CERRAR_CORTE: vendido reseteado a
    // 0 sin cerrar la pieza) — a diferencia de ELIMINAR_ITEM_CONSIGNACION,
    // NO toca stock ni lo regresa a bodega, porque la pieza no existe
    // físicamente en VEREX, ya está con el cliente que la compró.
    case "MARCAR_CONSIGNACION_VENDIDA": {
      if (!esAdmin) return forbidden();
      const itemMV = await sb.get("consignacion", d.id);
      if (!itemMV) { result = { ok: false, error: "Item no encontrado" }; break; }
      await sb.update("consignacion", d.id, { estado: "vendido" });
      result = { ok: true };
      break;
    }

    // Contraparte de MARCAR_CONSIGNACION_VENDIDA / recuperación manual —
    // vuelve un registro a estado:"activo" sin tocar cantidad ni vendido.
    // Uso: un item quedó cerrado como "vendido" por error (ej. con "Ya
    // vendida" antes de que existiera la pregunta NUEVA/LIQUIDADA) y su
    // venta ya se contó (vendido == cantidad), pero el vendedor TODAVÍA
    // no cobró esa comisión en ningún corte — sin reactivarlo, queda
    // invisible en el stock/comisión en vivo hasta el próximo corte sin
    // ninguna forma de notarlo. Úsalo solo si estás seguro de que esa
    // venta NO se pagó ya en un corte anterior — si se pagó, reactivarla
    // la haría contar de nuevo y pagar comisión dos veces.
    case "REACTIVAR_CONSIGNACION": {
      if (!esAdmin) return forbidden();
      const itemRC = await sb.get("consignacion", d.id);
      if (!itemRC) { result = { ok: false, error: "Item no encontrado" }; break; }
      await sb.update("consignacion", d.id, { estado: "activo" });
      result = { ok: true };
      break;
    }

    // Borra un registro de consignación de raíz, SIN mover stock — para
    // limpiar datos de prueba/basura (ej. registros huérfanos que ya no
    // tienen vendedor, o duplicados de prueba) donde restaurar unidades a
    // bodega inventaría stock que nunca existió físicamente. A diferencia
    // de ELIMINAR_ITEM_CONSIGNACION (que asume que la pieza SÍ vuelve
    // físicamente a VEREX), esto asume que la pieza nunca existió de verdad.
    case "ELIMINAR_CONSIGNACION_SIN_RESTAURAR": {
      if (!esAdmin) return forbidden();
      const itemESR = await sb.get("consignacion", d.id);
      if (!itemESR) { result = { ok: false, error: "Item no encontrado" }; break; }
      await sb.delete("consignacion", d.id);
      result = { ok: true };
      break;
    }

    // Backfill de SOLO REGISTRO — para ventas que ya se cobraron y ya se
    // liquidaron (ej. en un corte manual/antiguo) pero nunca dejaron un
    // registro individual en historialVentas. A propósito NO toca
    // consignacion.vendido ni stock_vendido: esos números YA están
    // correctos (el corte ya los contó); esto solo hace que la venta
    // aparezca en "Ventas generales" / Cierres Mensuales con su fecha
    // real, sin arriesgar que se vuelva a cobrar comisión por ella en
    // el próximo corte.
    case "REGISTRAR_VENTA_HISTORICA": {
      if (!esAdmin) return forbidden();
      if (!d.vendedor || !d.codigo) { result = { ok: false, error: "vendedor y codigo requeridos" }; break; }
      const vendRVH = await sb.get("vendedores", d.vendedor);
      if (!vendRVH) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      const historialRVH = Array.isArray(vendRVH.historialVentas) ? vendRVH.historialVentas : [];
      historialRVH.push({
        id: `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        codigo: d.codigo, nombre: d.nombre || "",
        precio: d.precio || 0, foto: d.foto || "",
        cantidad: parseInt(d.cantidad)||1,
        fecha: d.fecha ? new Date(d.fecha).toISOString() : new Date().toISOString(),
        soloRegistro: true
      });
      await sb.update("vendedores", d.vendedor, { historialVentas: historialRVH });
      result = { ok: true };
      break;
    }

    case "CERRAR_CORTE": {
      if (!esAdmin) return forbidden();
      for (const id of (d.devueltos || [])) {
        await sb.update("consignacion", id, { estado: "devuelto" });
      }
      const allCons = await sb.query("consignacion", "vendedor", "==", d.vendedor);
      for (const c of allCons.filter(c => c.estado === "activo")) {
        const cantC = parseInt(c.cantidad) || 0, vendC = parseInt(c.vendido) || 0;
        if (cantC > 0 && vendC >= cantC) {
          // Pieza totalmente vendida: se cierra en vez de resetear vendido
          // a 0 — antes esto dejaba cantidad intacta con vendido:0, así que
          // la pieza (ya vendida y ya cobrada en este mismo corte) volvía
          // a aparecer como "disponible" en el inventario del vendedor.
          await sb.update("consignacion", c.id, { estado: "vendido" });
        } else {
          await sb.update("consignacion", c.id, { vendido: 0 });
        }
      }
      await sb.update("vendedores", d.vendedor, {
        totalVendido: 0,
        fechaCorte: new Date().toISOString(),
        // Corte hecho ANTES de la fecha programada: si el admin eligió mantenerla, esa fecha se conserva
        // (si no, se borra y el ciclo vuelve a 30 días desde hoy).
        proximoCorte: (typeof d.mantenerProximoCorte === "string" && RE_FECHA_CORTE.test(d.mantenerProximoCorte) && !isNaN(Date.parse(d.mantenerProximoCorte))) ? d.mantenerProximoCorte : null
      });
      result = { ok: true };
      break;
    }

    // Fijar a mano la fecha del próximo corte de un vendedor (ver
    // diasParaCorteVend). fecha "AAAA-MM-DD"; vacía/null la quita y vuelve
    // a valer "último corte + 30 días". Es un parche: no pisa el resto de la ficha.
    case "FIJAR_PROXIMO_CORTE": {
      if (!esAdmin) return forbidden();
      const vendFP = await sb.get("vendedores", d.vendedor);
      if (!vendFP) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      const fechaFP = d.fecha ? String(d.fecha).trim() : null;
      if (fechaFP && (!RE_FECHA_CORTE.test(fechaFP) || isNaN(Date.parse(fechaFP)))) {
        result = { ok: false, error: "Fecha inválida (usa AAAA-MM-DD)" }; break;
      }
      await sb.update("vendedores", d.vendedor, { proximoCorte: fechaFP });
      result = { ok: true, proximoCorte: fechaFP };
      break;
    }

    case "GUARDAR_CORTE_HISTORIAL": {
      if (!esAdmin) return forbidden();
      const corteId = String(d.id);
      // cobrado: si al confirmar el corte el admin NO marcó "ya recibí el
      // pago", queda en false — aparece en "💰 Cobros pendientes" hasta
      // que alguien lo marque cobrado. Nada obliga a haber cobrado antes
      // de cerrar el corte; esto es solo el recordatorio de lo que falta.
      const cobradoInicial = !!d.cobrado;
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
        cobrado:           cobradoInicial,
        fechaCobro:        cobradoInicial ? new Date().toISOString() : null,
      });
      result = { ok: true };
      break;
    }

    // Marca un corte ya cerrado como cobrado (el dinero que VEREX debía
    // recibir de ese corte ya llegó). No toca inventario ni comisiones —
    // es solo el estado de cobro de ese registro del historial.
    case "MARCAR_CORTE_COBRADO": {
      if (!esAdmin) return forbidden();
      const corteCob = await sb.get("cortes_historial", d.id);
      if (!corteCob) { result = { ok: false, error: "Corte no encontrado" }; break; }
      await sb.update("cortes_historial", d.id, { cobrado: true, fechaCobro: new Date().toISOString() });
      result = { ok: true };
      break;
    }

    // Cortes cerrados sin marcar "ya recibí el pago" — para el aviso en
    // Dashboard/Hub. Los cortes de ANTES de este campo no tienen
    // `cobrado` guardado (undefined): se tratan como ya resueltos (no
    // pendientes) para no inundar con avisos retroactivos de algo que ya
    // se manejó por fuera del sistema; solo cuentan los que quedaron
    // explícitamente en cobrado:false.
    case "GET_CORTES_PENDIENTES_COBRO": {
      if (!esAdmin) return forbidden();
      const todosCortes = await sb.getAll("cortes_historial");
      result = { ok: true, cortes: todosCortes.filter(c => c.cobrado === false) };
      break;
    }

    case "GET_HISTORIAL_CORTES": {
      if (!esAdmin) return forbidden();   // teléfonos, ventas y comisiones de los vendedores
      const cortes = await sb.query("cortes_historial", "vendedor", "==", d.vendedor);
      result = { ok: true, cortes };
      break;
    }

    // Borra un registro del historial de cortes — para limpiar duplicados
    // (ej. los que deja un doble-tap en "Confirmar Corte", antes de que
    // se le pusiera protección). No toca inventario ni comisiones: solo
    // borra el registro de historial/cobro, no revierte el corte en sí.
    case "ELIMINAR_CORTE_HISTORIAL": {
      if (!esAdmin) return forbidden();
      const corteDel = await sb.get("cortes_historial", d.id);
      if (!corteDel) { result = { ok: false, error: "Corte no encontrado" }; break; }
      await sb.delete("cortes_historial", d.id);
      result = { ok: true };
      break;
    }

    // Todos los cortes (de cualquier vendedor), marcando cuáles son de un
    // afiliado sin stock físico — el Dashboard usa esto para descontar del
    // ingreso bruto la comisión YA pagada a esos afiliados.
    case "GET_CORTES_HISTORIAL_TODOS": {
      if (!esAdmin) return forbidden();
      const [cortes, vends] = await Promise.all([
        sb.getAll("cortes_historial"),
        sb.getAll("vendedores")
      ]);
      const vendMap = new Map(vends.map(v => [v.codigo, v]));
      const enriquecidos = cortes.map(c => {
        const vend = vendMap.get(c.vendedor);
        return { ...c, esAfiliadoSinStock: vend?.tipo === "afiliado" && !vend?.recibeFisico };
      });
      result = { ok: true, cortes: enriquecidos };
      break;
    }

    case "REGISTRAR_VENTA_VENDEDOR": {
      const chkRVV = await validarVendedorToken(sb, d.vendedor, d.token, d.pin);
      if (!chkRVV.ok) { result = { ok: false, error: chkRVV.error }; break; }
      const consV = await sb.get("consignacion", d.id);
      if (!consV) { result = { ok: false, error: "Item no encontrado" }; break; }
      if (String(consV.vendedor) !== String(d.vendedor)) {
        result = { ok: false, error: "Esta pieza no pertenece a este vendedor" }; break;
      }
      const cantVentaV = parseInt(d.cantidad) || 1;
      const nuevoVendidoV = (parseInt(consV.vendido)||0) + cantVentaV;
      // Mismo motivo que en REGISTRAR_VENTA: solo CERRAR_CORTE debe dejar
      // un registro en estado:"vendido" — cualquier otro camino que
      // cuenta una venta debe mantenerlo "activo" para que siga
      // contando en el stock/comisión en vivo hasta el próximo corte.
      await sb.update("consignacion", d.id, { vendido: nuevoVendidoV, estado: "activo" });
      const sV = await sb.get("stock", consV.codigo);
      if (sV) {
        await sb.update("stock", consV.codigo, {
          stock_vendido:      (parseInt(sV.stock_vendido)||0) + cantVentaV,
          // La pieza ya no está "en circulación" con el vendedor — sin
          // esto, stock_consignacion quedaba inflado para siempre con
          // cada venta (nunca bajaba), la causa de los 12 casos
          // "fantasma" que encontró la auditoría para Jaime Solórzano.
          stock_consignacion: Math.max(0, (parseInt(sV.stock_consignacion)||0) - cantVentaV)
        });
      }
      // Se guarda un registro INDIVIDUAL de esta venta (con su fecha/hora
      // real) dentro del vendedor, en vez de solo incrementar el contador
      // "vendido" compartido — antes GET_VENTAS_VENDEDOR devolvía el
      // registro de consignación completo (con la fecha de ENTREGA de la
      // pieza, no la de la venta), así que el historial del vendedor
      // mostraba fechas/horas equivocadas para cada venta.
      const ventaIdV = `VV_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const vendV = chkRVV.vend;
      const historialV = vendV && Array.isArray(vendV.historialVentas) ? vendV.historialVentas : [];
      historialV.push({
        id: ventaIdV, consignacionId: d.id,
        codigo: consV.codigo, nombre: d.nombre || consV.nombre || "",
        precio: d.precio ?? consV.precio ?? 0, foto: d.foto || consV.foto || "",
        cantidad: cantVentaV, fecha: new Date().toISOString()
      });
      if (vendV) await sb.update("vendedores", d.vendedor, { historialVentas: historialV });

      // El aviso de reposición NO debe salir solo porque el vendedor
      // vendió su última pieza regular (eso no requiere reponer nada
      // todavía) — debe salir únicamente cuando esta venta YA fue una
      // venta "bajo pedido" de verdad: vendido superó la cantidad física
      // que tenía, o sea, un cliente nuevo pidió la pieza estando ya
      // agotada con él. Ahí sí hay que reponerle para poder cumplirla.
      const cantidadFisicaV = parseInt(consV.cantidad) || 0;
      const esVentaBajoPedido = nuevoVendidoV > cantidadFisicaV;
      if (esVentaBajoPedido && (parseInt(sV?.stock_bodega)||0) > 0 && vendV) {
        const pendientesV = Array.isArray(vendV.reposicionesPendientes) ? vendV.reposicionesPendientes : [];
        if (!pendientesV.some(r => r.codigo === consV.codigo)) {
          pendientesV.push({ codigo: consV.codigo, nombre: consV.nombre || "", fecha: new Date().toISOString() });
          await sb.update("vendedores", d.vendedor, { reposicionesPendientes: pendientesV });
        }
      }
      result = { ok: true, ventaId: ventaIdV };
      break;
    }

    case "GET_REPOSICIONES_PENDIENTES": {
      if (!esAdmin) return forbidden();
      const todosVendRep = await sb.getAll("vendedores");
      const reposiciones = [];
      for (const v of todosVendRep) {
        for (const r of (v.reposicionesPendientes || [])) {
          reposiciones.push({ vendedor: v.codigo, vendedorNombre: v.nombre, codigo: r.codigo, nombre: r.nombre, fecha: r.fecha });
        }
      }
      result = { ok: true, reposiciones };
      break;
    }

    case "RESOLVER_REPOSICION": {
      if (!esAdmin) return forbidden();
      if (!d.vendedor || !d.codigo) { result = { ok: false, error: "vendedor y codigo requeridos" }; break; }
      const vendRes = await sb.get("vendedores", d.vendedor);
      if (!vendRes) { result = { ok: false, error: "Vendedor no encontrado" }; break; }
      const restantesRes = (vendRes.reposicionesPendientes || []).filter(r => r.codigo !== d.codigo);
      await sb.update("vendedores", d.vendedor, { reposicionesPendientes: restantesRes });
      result = { ok: true };
      break;
    }

    case "GET_VENTAS_VENDEDOR": {
      if (!esAdmin) {
        const chkGV = await validarVendedorToken(sb, d.vendedor, d.token, d.pin);
        if (!chkGV.ok) { result = { ok: false, error: chkGV.error }; break; }
      }
      const vendGV = await sb.get("vendedores", d.vendedor);
      result = { ok: true, ventas: (vendGV && Array.isArray(vendGV.historialVentas)) ? vendGV.historialVentas : [] };
      break;
    }

    // Migración de UNA SOLA VEZ: antes de que existiera historialVentas,
    // una venta solo incrementaba consignacion.vendido sin dejar registro
    // individual — así que "Mis Ventas" quedó vacío para todo lo vendido
    // antes de esa fecha, aunque el vendedor sí lo vendió y VEREX ya lo
    // sabe (está en el total de consignacion.vendido). Esto rellena un
    // registro aproximado por cada item ya vendido que aún no tenga
    // historial, usando la fecha de ENTREGA como mejor aproximación
    // disponible (marcado "migrado" para dejarlo claro). Es idempotente:
    // se puede correr varias veces sin duplicar, porque salta cualquier
    // consignacionId que ya tenga un registro (migrado o real).
    case "MIGRAR_HISTORIAL_VENTAS_ANTIGUAS": {
      if (!esAdmin) return forbidden();
      const [todosVendMig, todaConsMig] = await Promise.all([
        sb.getAll("vendedores"),
        sb.getAll("consignacion"),
      ]);
      let creados = 0;
      for (const v of todosVendMig) {
        const historialMig = Array.isArray(v.historialVentas) ? [...v.historialVentas] : [];
        const yaTiene = new Set(historialMig.map(h => h.consignacionId).filter(Boolean));
        const itemsVend = todaConsMig.filter(c => c.vendedor === v.codigo && (parseInt(c.vendido)||0) > 0);
        let cambiado = false;
        for (const c of itemsVend) {
          if (yaTiene.has(c.id)) continue;
          historialMig.push({
            id: `MIG_${c.id}`, consignacionId: c.id,
            codigo: c.codigo, nombre: c.nombre || "",
            precio: c.precio || 0, foto: c.foto || "",
            cantidad: parseInt(c.vendido)||1,
            fecha: c.fecha || new Date().toISOString(),
            migrado: true
          });
          cambiado = true; creados++;
        }
        if (cambiado) await sb.update("vendedores", v.codigo, { historialVentas: historialMig });
      }
      result = { ok: true, creados };
      break;
    }

    case "SOLICITAR_CORRECCION_VENTA": {
      const solId = `SOL_${Date.now()}`;
      await sb.set("solicitudes_correccion", solId, {
        id: solId, ventaId: d.ventaId || "",
        vendedor: d.vendedor || "", vendedorNombre: d.vendedorNombre || "", motivo: d.motivo || "",
        codigo: d.codigo || "", nombre: d.nombre || "", cantidad: parseInt(d.cantidad)||1,
        estado: "pendiente",
        fecha: new Date().toISOString()
      });
      result = { ok: true };
      break;
    }

    case "GET_DEVOLUCIONES_VENDEDOR": {
      if (!esAdmin) return forbidden();
      const devs = await sb.query("devoluciones", "vendedor", "==", d.vendedor);
      result = { ok: true, devoluciones: devs };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
