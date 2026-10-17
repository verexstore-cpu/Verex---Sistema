// Ventas directas: registro, abonos, cambios y devoluciones
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { descontarStockVentaDirecta } from "../lib/stock-bloque.js";
import { completarPrecioPagadoVD, planearCambioVD, r2VD } from "../lib/ventas-directas.js";

export async function accionesVentasDirectas({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "REGISTRAR_VENTA_DIRECTA": {
      if (!esAdmin) return forbidden();
      const vdId = d.id || `VD_${Date.now()}`;
      await sb.set("ventas_directas", vdId, {
        id: vdId, fecha: d.fecha || new Date().toISOString(),
        cliente: d.cliente || "", telefono: d.telefono || "",
        items: JSON.stringify(completarPrecioPagadoVD(d.items || [], d.descuento)),
        subtotal: d.subtotal || d.total || 0,
        descuento: d.descuento || 0,
        descuentoTipo:  d.descuentoTipo  || "monto",
        descuentoValor: d.descuentoValor || 0,
        costoEnvio: d.costoEnvio || 0,
        direccionEnvio: d.direccionEnvio || "",
        departamentoEnvio: d.departamentoEnvio || "",
        empresaEnvio: d.empresaEnvio || "",
        total: d.total || 0,
        tipo: d.tipo || "contado",
        metodoPago: d.metodoPago || "efectivo",
        enganche: d.enganche || 0,
        saldoPendiente: d.saldoPendiente || 0,
        nota: d.nota || "",
        estado: d.estado || "pagado"
      });
      // Registrar/actualizar el cliente en el mismo directorio que usa el ecommerce
      // (deduplicado por teléfono), para que aparezca en Clientes con su canal.
      if (d.telefono) {
        const clientesVD = await sb.getAll("clientes");
        const normTelVD = t => String(t || "").replace(/\D/g, "");
        const cliExistVD = clientesVD.find(c => normTelVD(c.telefono) === normTelVD(d.telefono));
        if (cliExistVD) {
          await sb.update("clientes", cliExistVD.codigo, {
            totalPedidos: (parseInt(cliExistVD.totalPedidos)||0) + 1,
            totalPedidosDirecta: (parseInt(cliExistVD.totalPedidosDirecta)||0) + 1,
            // Solo guarda la dirección/departamento si el cliente aún no
            // tenía uno — no pisa datos ya conocidos con un envío distinto.
            ...(!cliExistVD.direccion && d.direccionEnvio ? { direccion: d.direccionEnvio } : {}),
            ...(!cliExistVD.departamento && d.departamentoEnvio ? { departamento: d.departamentoEnvio } : {})
          });
        } else {
          const codigoClienteVD = `CVX-${String(clientesVD.length + 1).padStart(3, "0")}`;
          await sb.set("clientes", codigoClienteVD, {
            codigo: codigoClienteVD, nombre: d.cliente || "", telefono: d.telefono,
            correo: "", municipio: "", direccion: d.direccionEnvio || "", departamento: d.departamentoEnvio || "",
            totalPedidos: 1, totalPedidosEcommerce: 0, totalPedidosDirecta: 1,
            fechaRegistro: new Date().toISOString()
          });
        }
      }
      // Descuento de inventario ATÓMICO (misma reserva que la tienda online): dos ventas simultáneas de la última unidad
      // ya no pueden vender de más. Ver descontarStockVentaDirecta.
      const { itemsSinStock, faltantes } = await descontarStockVentaDirecta(sb, d.items || []);
      result = { ok: true, itemsSinStock, faltantes };
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

    case "ACTUALIZAR_DESCUENTO_VD": {
      if (!esAdmin) return forbidden();
      const vd = await sb.get("ventas_directas", d.id);
      if (!vd) { result = { ok: false, error: "Venta no encontrada" }; break; }
      // Si viene totalReal, el total registrado estaba mal y hay que corregirlo.
      // subtotal = precio sin descuento (lo que estaba registrado antes),
      // total    = precio real cobrado al cliente.
      const subtotalNuevo = parseFloat(d.subtotal) || parseFloat(vd.total || 0);
      const totalNuevo    = (d.totalReal != null) ? parseFloat(d.totalReal) : parseFloat(vd.total || 0);
      const descNuevo     = Math.max(0, subtotalNuevo - totalNuevo);
      // Lo ya pagado hasta ahora = total viejo - saldo viejo (incluye enganche
      // Y cualquier abono ya registrado). Usar "enganche" acá era el bug: con
      // enganche=0 (crédito sin inicial), "0 || totalNuevo" da totalNuevo en JS
      // (0 es falsy), dejando el saldo en $0 aunque no se hubiera pagado nada.
      const pagadoHastaAhora = Math.max(0, (parseFloat(vd.total)||0) - (parseFloat(vd.saldoPendiente)||0));
      // El descuento cambió: lo que se pagó por cada pieza hay que repartirlo de nuevo.
      let itemsDescNuevos;
      try {
        itemsDescNuevos = completarPrecioPagadoVD(
          JSON.parse(vd.items || "[]").map(({ precioPagado, ...it }) => it), descNuevo);
      } catch (_) {}
      await sb.update("ventas_directas", d.id, {
        ...(itemsDescNuevos ? { items: JSON.stringify(itemsDescNuevos) } : {}),
        subtotal:       subtotalNuevo,
        total:          totalNuevo,
        descuento:      descNuevo,
        descuentoTipo:  d.descuentoTipo  || "monto",
        descuentoValor: d.descuentoValor || descNuevo,
        saldoPendiente: Math.max(0, totalNuevo - pagadoHastaAhora),
        // si al cambiar el descuento ya no se debe nada, la venta a crédito pasa a pagada (antes quedaba "crédito" con saldo $0)
        estado: Math.max(0, totalNuevo - pagadoHastaAhora) <= 0.005 ? "pagado" : "credito",
      });
      result = { ok: true };
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

    case "CAMBIAR_PRODUCTO_VENTA_DIRECTA": {
      // Cambio de una o varias piezas en una venta directa ya registrada
      // (ej. devolución por cambio). Regresa las piezas viejas a bodega,
      // descuenta las nuevas, y ajusta total/saldoPendiente según lo que
      // el cliente PAGÓ por cada pieza vieja (con su parte del descuento)
      // contra el precio de la nueva — la nueva no hereda el descuento
      // salvo que el cambio traiga aplicaDescuento:true. Puede subir el
      // saldo (pieza nueva más cara / descuento perdido) o bajarlo.
      // Acepta `cambios: [{codigoViejo, codigoNuevo, aplicaDescuento}]`, o
      // el formato viejo de una sola pieza (codigoViejo/codigoNuevo).
      // soloCalcular:true devuelve el desglose sin guardar nada.
      if (!esAdmin) return forbidden();
      const vdCam = await sb.get("ventas_directas", d.id);
      if (!vdCam) { result = { ok: false, error: "Venta no encontrada" }; break; }
      const cambiosCam = Array.isArray(d.cambios) && d.cambios.length
        ? d.cambios
        : [{ codigoViejo: d.codigoViejo, codigoNuevo: d.codigoNuevo, aplicaDescuento: d.aplicaDescuento }];
      const planCam = await planearCambioVD(sb, vdCam, cambiosCam);
      if (planCam.error) { result = { ok: false, error: planCam.error }; break; }

      const resumenCam = {
        lineas: planCam.lineas, diferencia: planCam.diferencia,
        nuevoTotal: planCam.total, nuevoSaldo: planCam.saldo,
        aFavorCliente: planCam.aFavorCliente
      };
      if (d.soloCalcular) { result = { ok: true, preview: true, ...resumenCam }; break; }

      for (const [codigo, campos] of Object.entries(planCam.stockUpdates)) {
        await sb.update("stock", codigo, campos);
      }
      const fechaCam = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
      const notaCam = planCam.lineas.map(l =>
        `🔄 Cambio el ${fechaCam}: "${l.nombreViejo}" (${l.codigoViejo}) → "${l.nombreNuevo}" (${l.codigoNuevo})` +
        (l.diferencia !== 0 ? ` — diferencia $${l.diferencia.toFixed(2)}` : "") +
        (l.descuentoViejo > 0 && !l.aplicaDescuento ? " (sin descuento en la pieza nueva)" : "") +
        (d.motivo ? " — Motivo: " + d.motivo : "")
      ).join("\n") + (planCam.aFavorCliente > 0 ? `\n⚠️ A favor del cliente: $${planCam.aFavorCliente.toFixed(2)}` : "");

      const patchCam = {
        items: JSON.stringify(planCam.items),
        total: planCam.total,
        subtotal: planCam.subtotal,
        saldoPendiente: planCam.saldo,
        estado: planCam.saldo <= 0 ? "pagado" : "credito",
        nota: (vdCam.nota ? vdCam.nota + "\n" : "") + notaCam
      };
      // El descuento cambió (una pieza con descuento se fue): un "10%"
      // guardado ya no describe la venta, así que queda como monto exacto.
      if (planCam.descuento !== r2VD(vdCam.descuento)) {
        patchCam.descuento = planCam.descuento;
        patchCam.descuentoTipo = "monto";
        patchCam.descuentoValor = planCam.descuento;
      }
      await sb.update("ventas_directas", d.id, patchCam);
      result = { ok: true, ...resumenCam };
      break;
    }

    case "AGREGAR_PRODUCTO_VENTA_DIRECTA": {
      // Suma una pieza NUEVA a una venta directa ya registrada (ej. el
      // cliente aprovecha una devolución/cambio para llevarse algo más)
      // — a diferencia de CAMBIAR_PRODUCTO_VENTA_DIRECTA, esto no quita
      // nada, solo agrega, así el cliente queda con un solo saldo
      // combinado en vez de dos créditos sueltos que rastrear.
      if (!esAdmin) return forbidden();
      const vdAdd = await sb.get("ventas_directas", d.id);
      if (!vdAdd) { result = { ok: false, error: "Venta no encontrada" }; break; }
      const codigoAdd = String(d.codigo || "").trim();
      if (!codigoAdd) { result = { ok: false, error: "Falta el código del producto" }; break; }
      const cantAdd = Math.max(1, parseInt(d.cantidad) || 1);
      const sAdd = await sb.get("stock", codigoAdd);
      if (!sAdd) { result = { ok: false, error: "El producto (" + codigoAdd + ") no existe en stock" }; break; }
      const dispAdd = (parseInt(sAdd.stock_bodega)||0) + (parseInt(sAdd.stock_tienda)||0);
      if (dispAdd < cantAdd) { result = { ok: false, error: "Sin stock suficiente" }; break; }

      const bodAdd = parseInt(sAdd.stock_bodega)||0, tieAdd = parseInt(sAdd.stock_tienda)||0;
      const restaBodAdd = Math.min(cantAdd, bodAdd);
      await sb.update("stock", codigoAdd, {
        stock_bodega: Math.max(0, bodAdd - restaBodAdd),
        stock_tienda: Math.max(0, tieAdd - (cantAdd - restaBodAdd)),
        stock_vendido: (parseInt(sAdd.stock_vendido)||0) + cantAdd
      });

      // Antes de sumar la pieza nueva (sin descuento), fijar lo que pagó el
      // cliente por las que ya tenía — si no, al repartir el descuento de la
      // venta después, la pieza nueva le quitaría parte a las viejas.
      const itemsAdd = completarPrecioPagadoVD(JSON.parse(vdAdd.items || "[]"), vdAdd.descuento);
      const precioAdd = parseFloat(sAdd.precio) || 0;
      itemsAdd.push({
        codigo: codigoAdd,
        nombre: sAdd.nombre_base || sAdd.nombre || codigoAdd,
        precio: precioAdd,
        precioPagado: precioAdd,
        cantidad: cantAdd,
        fechaAgregado: new Date().toISOString() // para que el recibo marque que no es de la compra original
      });
      const montoAdd = precioAdd * cantAdd;
      const totalAdd = (parseFloat(vdAdd.total)||0) + montoAdd;
      const subtotalAdd = (parseFloat(vdAdd.subtotal)||0) + montoAdd;
      const saldoAdd = (parseFloat(vdAdd.saldoPendiente)||0) + montoAdd;
      const fechaAdd = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
      const notaAdd = `➕ Pieza agregada el ${fechaAdd}: "${itemsAdd[itemsAdd.length-1].nombre}" (${codigoAdd}) x${cantAdd} — $${montoAdd.toFixed(2)}`;

      await sb.update("ventas_directas", d.id, {
        items: JSON.stringify(itemsAdd),
        total: totalAdd,
        subtotal: subtotalAdd,
        saldoPendiente: saldoAdd,
        estado: saldoAdd <= 0 ? "pagado" : "credito",
        nota: (vdAdd.nota ? vdAdd.nota + "\n" : "") + notaAdd
      });
      result = { ok: true, montoAgregado: montoAdd, nuevoTotal: totalAdd, nuevoSaldo: saldoAdd };
      break;
    }

    case "CORREGIR_SALDO_VD": {
      // Corrección manual — repara ventas donde subtotal/total/saldo quedaron
      // desalineados de la suma real de productos (ver nota de arriba en
      // AGREGAR/CAMBIAR: cada acción solo suma/resta un número al anterior,
      // así que un error en un paso arrastra a todos los siguientes).
      // Si solo viene saldoPendiente, se comporta como antes (ajuste rápido).
      // Si vienen subtotal/total, se corrigen también esos campos juntos.
      if (!esAdmin) return forbidden();
      const vdCorr = await sb.get("ventas_directas", d.id);
      if (!vdCorr) { result = { ok: false, error: "Venta no encontrada" }; break; }
      const nuevoSaldoCorr = Math.max(0, parseFloat(d.saldoPendiente) || 0);
      const patchCorr = {
        saldoPendiente: nuevoSaldoCorr,
        estado: nuevoSaldoCorr <= 0 ? "pagado" : "credito",
      };
      if (d.subtotal != null) patchCorr.subtotal = Math.max(0, parseFloat(d.subtotal) || 0);
      if (d.total != null)    patchCorr.total    = Math.max(0, parseFloat(d.total) || 0);
      if (d.descuento != null) patchCorr.descuento = Math.max(0, parseFloat(d.descuento) || 0);
      await sb.update("ventas_directas", d.id, patchCorr);
      result = { ok: true, nuevoSaldo: nuevoSaldoCorr, patch: patchCorr };
      break;
    }

    // Devolución (total o parcial) de una pieza de una venta directa: la pieza vuelve a bodega, la venta baja por lo que se pagó por ella
    // y el saldo se recalcula (si el cliente ya había pagado más de lo que queda, el sobrante se avisa como "a favor del cliente").
    case "DEVOLVER_PIEZA_VD": {
      if (!esAdmin) return forbidden();
      const vdDev = await sb.get("ventas_directas", d.id);
      if (!vdDev) { result = { ok: false, error: "Venta no encontrada" }; break; }
      let itemsOrigDev = [];
      try { itemsOrigDev = JSON.parse(vdDev.items || "[]"); } catch (_) {}
      const itemsDev = completarPrecioPagadoVD(itemsOrigDev, vdDev.descuento);
      const idxDev = itemsDev.findIndex(it => it.codigo === String(d.codigo || ""));
      if (idxDev === -1) { result = { ok: false, error: "Esa pieza no está en esta venta" }; break; }
      const itDev = itemsDev[idxDev];
      const cantItemDev = parseInt(itDev.cantidad) || 1;
      const cantDev = Math.min(cantItemDev, Math.max(1, parseInt(d.cantidad) || cantItemDev));
      const listaDev = (parseFloat(itDev.precio) || 0) * cantDev;
      const pagadoDev = (parseFloat(itDev.precioPagado) || 0) * cantDev;   // lo que costó la pieza ya con su parte del descuento
      const saldoCrudoDev = r2VD((parseFloat(vdDev.saldoPendiente) || 0) - pagadoDev);
      const itemsQuedan = itemsDev.map((it, i) => i === idxDev ? { ...it, cantidad: cantItemDev - cantDev } : it).filter(it => (parseInt(it.cantidad) || 0) > 0);
      const resumenDev = {
        pieza: itDev.nombre || itDev.codigo, cantidad: cantDev, valor: r2VD(pagadoDev),
        pagadoHastaAhora: Math.max(0, r2VD((parseFloat(vdDev.total) || 0) - (parseFloat(vdDev.saldoPendiente) || 0))),
        totalAntes: r2VD(parseFloat(vdDev.total) || 0), nuevoTotal: Math.max(0, r2VD((parseFloat(vdDev.total) || 0) - pagadoDev)),
        nuevoSaldo: Math.max(0, saldoCrudoDev), aFavorCliente: saldoCrudoDev < 0 ? r2VD(-saldoCrudoDev) : 0,
        quedanPiezas: itemsQuedan.length
      };
      if (d.soloCalcular) { result = { ok: true, preview: true, ...resumenDev }; break; }

      const stDev = await sb.get("stock", itDev.codigo);
      if (stDev) {
        await sb.update("stock", itDev.codigo, {
          stock_bodega: (parseInt(stDev.stock_bodega) || 0) + cantDev,
          stock_vendido: Math.max(0, (parseInt(stDev.stock_vendido) || 0) - cantDev)
        });
      }
      const fechaDev = new Date().toLocaleDateString("es-SV", { day: "numeric", month: "short", year: "numeric" });
      const motivoDev = String(d.motivo || "").trim().slice(0, 200);
      const notaDev = `↩️ Devolución el ${fechaDev}: "${itDev.nombre || itDev.codigo}" (${itDev.codigo}) x${cantDev} — $${r2VD(pagadoDev).toFixed(2)}` +
        (motivoDev ? " — Motivo: " + motivoDev : "") + " — vuelve a bodega" +
        (resumenDev.aFavorCliente > 0 ? `\n⚠️ A favor del cliente: $${resumenDev.aFavorCliente.toFixed(2)}` : "");
      const patchDev = {
        items: JSON.stringify(itemsQuedan),
        total: resumenDev.nuevoTotal,
        subtotal: Math.max(0, r2VD((parseFloat(vdDev.subtotal) || 0) - listaDev)),
        saldoPendiente: resumenDev.nuevoSaldo,
        estado: itemsQuedan.length === 0 ? "devuelto" : (resumenDev.nuevoSaldo <= 0.005 ? "pagado" : "credito"),
        nota: (vdDev.nota ? vdDev.nota + "\n" : "") + notaDev,
        devoluciones: [...(Array.isArray(vdDev.devoluciones) ? vdDev.devoluciones : []), {
          fecha: new Date().toISOString(), codigo: itDev.codigo, nombre: itDev.nombre || "", cantidad: cantDev, valor: r2VD(pagadoDev), motivo: motivoDev
        }]
      };
      const descNuevoDev = Math.max(0, r2VD((parseFloat(vdDev.descuento) || 0) - (listaDev - pagadoDev)));
      if (descNuevoDev !== r2VD(vdDev.descuento)) { patchDev.descuento = descNuevoDev; patchDev.descuentoTipo = "monto"; patchDev.descuentoValor = descNuevoDev; }
      await sb.update("ventas_directas", d.id, patchDev);
      result = { ok: true, ...resumenDev };
      break;
    }

    case "CAMBIAR_FORMA_PAGO_VD": {
      // Corrige una venta registrada con la forma de pago equivocada
      // (Contado cuando en realidad quedó a crédito, o viceversa) — a
      // diferencia de CORREGIR_SALDO_VD, esto NO toca subtotal/total/
      // descuento, solo tipo/estado/enganche/saldoPendiente.
      if (!esAdmin) return forbidden();
      const vdForma = await sb.get("ventas_directas", d.id);
      if (!vdForma) { result = { ok: false, error: "Venta no encontrada" }; break; }
      const nuevoTipoForma = d.tipo === "credito" ? "credito" : "contado";
      const nuevoSaldoForma = nuevoTipoForma === "credito" ? Math.max(0, parseFloat(d.saldoPendiente) || 0) : 0;
      const totalActualForma = parseFloat(vdForma.total || 0);
      const patchForma = {
        tipo: nuevoTipoForma,
        metodoPago: nuevoTipoForma === "credito" ? "credito" : (vdForma.metodoPago && vdForma.metodoPago !== "credito" ? vdForma.metodoPago : "efectivo"),
        enganche: Math.max(0, totalActualForma - nuevoSaldoForma),
        saldoPendiente: nuevoSaldoForma,
        estado: nuevoSaldoForma > 0 ? "credito" : "pagado",
      };
      await sb.update("ventas_directas", d.id, patchForma);
      result = { ok: true, patch: patchForma };
      break;
    }

    case "MARCAR_FECHA_ITEM_VD": {
      // Repara piezas agregadas/cambiadas ANTES de que existiera el
      // marcador de fecha en el recibo (AGREGAR/CAMBIAR_PRODUCTO_VENTA_
      // DIRECTA) — les asigna fechaAgregado retroactivamente.
      if (!esAdmin) return forbidden();
      const vdFecha = await sb.get("ventas_directas", d.id);
      if (!vdFecha) { result = { ok: false, error: "Venta no encontrada" }; break; }
      const itemsFecha = JSON.parse(vdFecha.items || "[]");
      const idxFecha = itemsFecha.findIndex(it => it.codigo === d.codigo);
      if (idxFecha === -1) { result = { ok: false, error: "Producto no encontrado en esta venta" }; break; }
      itemsFecha[idxFecha] = { ...itemsFecha[idxFecha], fechaAgregado: d.fecha || new Date().toISOString() };
      await sb.update("ventas_directas", d.id, { items: JSON.stringify(itemsFecha) });
      result = { ok: true };
      break;
    }

    case "GET_ABONOS_VENTA": {
      if (!esAdmin) return forbidden();
      const abonos = await sb.query("abonos", "ventaId", "==", d.ventaId);
      result = { ok: true, abonos };
      break;
    }

    // Migración/sincronización (segura de correr varias veces — recalcula, no
    // incrementa). Normaliza teléfonos (quita guiones/espacios) para detectar
    // que son la misma persona, fusiona clientes duplicados por número mal
    // formateado, y recalcula el conteo por canal desde los datos reales
    // (pedidos = ecommerce, ventas_directas = directa).
    case "MIGRAR_CLIENTES_VENTA_DIRECTA": {
      if (!esAdmin) return forbidden();
      const normTel = t => String(t || "").replace(/\D/g, "");
      const [ventasDirectas, pedidosAll, clientesAll] = await Promise.all([
        sb.getAll("ventas_directas"),
        sb.getAll("pedidos"),
        sb.getAll("clientes")
      ]);

      // 1. Agrupar clientes existentes por teléfono normalizado y fusionar duplicados
      const grupos = {};
      for (const c of clientesAll) {
        const tn = normTel(c.telefono);
        if (!tn) continue;
        (grupos[tn] = grupos[tn] || []).push(c);
      }
      let fusionados = 0;
      const vivos = {}; // tn -> cliente representativo (ya actualizado en memoria)
      for (const [tn, grupo] of Object.entries(grupos)) {
        grupo.sort((a, b) => new Date(a.fechaRegistro || 0) - new Date(b.fechaRegistro || 0));
        const principal = grupo[0];
        if (grupo.length > 1) {
          const sumaEco = grupo.reduce((s, c) => s + (parseInt(c.totalPedidosEcommerce) || 0), 0);
          const sumaDir = grupo.reduce((s, c) => s + (parseInt(c.totalPedidosDirecta) || 0), 0);
          await sb.update("clientes", principal.codigo, {
            totalPedidosEcommerce: sumaEco,
            totalPedidosDirecta: sumaDir,
            totalPedidos: sumaEco + sumaDir
          });
          for (let i = 1; i < grupo.length; i++) { await sb.delete("clientes", grupo[i].codigo); fusionados++; }
          vivos[tn] = { ...principal, totalPedidosEcommerce: sumaEco, totalPedidosDirecta: sumaDir, totalPedidos: sumaEco + sumaDir };
        } else {
          vivos[tn] = principal;
        }
      }

      // 2. Contar pedidos reales (ecommerce) y ventas directas por teléfono normalizado
      const ecoPorTel = {};
      for (const p of pedidosAll) {
        const tn = normTel(p.telefono);
        if (tn) ecoPorTel[tn] = (ecoPorTel[tn] || 0) + 1;
      }
      const dirPorTel = {};
      for (const vd of ventasDirectas) {
        const tn = normTel(vd.telefono);
        if (!tn) continue;
        if (!dirPorTel[tn]) dirPorTel[tn] = { nombre: "", count: 0 };
        dirPorTel[tn].count++;
        if (!dirPorTel[tn].nombre && vd.cliente) dirPorTel[tn].nombre = vd.cliente;
      }

      // 3. Aplicar conteos reales — crea el cliente si no existía, actualiza si sí
      let creados = 0, actualizados = 0;
      const todosTel = new Set([...Object.keys(ecoPorTel), ...Object.keys(dirPorTel), ...Object.keys(vivos)]);
      let nextNum = clientesAll.length - fusionados + 1;
      for (const tn of todosTel) {
        const eco = ecoPorTel[tn] || 0;
        const dir = dirPorTel[tn]?.count || 0;
        const existente = vivos[tn];
        if (existente) {
          const ecoActual = parseInt(existente.totalPedidosEcommerce) || 0;
          const dirActual = parseInt(existente.totalPedidosDirecta) || 0;
          const nuevoEco = Math.max(ecoActual, eco);
          const nuevoDir = Math.max(dirActual, dir);
          if (nuevoEco !== ecoActual || nuevoDir !== dirActual) {
            await sb.update("clientes", existente.codigo, {
              totalPedidosEcommerce: nuevoEco, totalPedidosDirecta: nuevoDir, totalPedidos: nuevoEco + nuevoDir
            });
            actualizados++;
          }
        } else if (dir > 0) {
          const codigoCliente = `CVX-${String(nextNum++).padStart(3, "0")}`;
          await sb.set("clientes", codigoCliente, {
            codigo: codigoCliente, nombre: dirPorTel[tn].nombre, telefono: tn,
            correo: "", municipio: "", direccion: "", departamento: "",
            totalPedidos: dir, totalPedidosEcommerce: 0, totalPedidosDirecta: dir,
            fechaRegistro: new Date().toISOString()
          });
          creados++;
        }
      }
      result = { ok: true, creados, actualizados, fusionados, totalVentasDirectas: ventasDirectas.length };
      break;
    }

    // Solo para corregir una venta duplicada por doble clic (ver guard
    // _vdEnviando en el frontend) — no toca stock porque
    // REGISTRAR_VENTA_DIRECTA tampoco lo descuenta server-side.
    case "ELIMINAR_VENTA_DIRECTA": {
      if (!esAdmin) return forbidden();
      if (!d.id) { result = { ok: false, error: "Falta el id" }; break; }
      await sb.delete("ventas_directas", d.id);
      result = { ok: true };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
