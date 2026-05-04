// ═══════════════════════════════════════════════════════════════════
//  VEREX STORE — Google Apps Script Backend  (v2 — con stock por talla)
//
//  Hojas requeridas en tu Google Sheets:
//    - productos       → id | nombre | codigo | precio | img | caracteristicas | activo | destacado
//    - pedidos         → fecha | numeroPedido | cliente | telefono | municipio | direccion | productos | total | estado | metodoPago | items | cuponUsado | descMonto | envio | telLlamada | correo | departamento
//    - cupones         → codigo | tipo | descuento | categorias | montoMinimo | limiteUsos | usosActuales | activo
//    - config          → clave | valor
//    - clientes        → codigo | nombre | telefono | municipio | direccion | totalPedidos | fechaRegistro | departamento
//    - vendedores      → codigo | nombre | telefono | totalEntregado | totalVendido | fechaCorte | tokenInventario
//    - consignacion    → id | vendedor | codigo | nombre | codigoBase | talla | nombre_base | categoria | precio | cantidad | vendido | foto | fecha | estado
//    - cortesHistorial → id | vendedor | fecha | totalVendido | comisionPct | gananciaVendedor | aPagarVerex
//    - stock           → codigo | codigoBase | talla | nombre | nombre_base | categoria | precio | foto | descripcion | descripcionTienda | estado | stock_bodega | stock_tienda | stock_consignacion | stock_vendido | fechaRegistro
//
//  CAMBIOS v2 respecto a v1:
//    • Hoja "consignacion" ahora incluye columnas codigoBase, talla, nombre_base
//    • Nueva hoja "stock" para rastreo de inventario por talla
//    • Nuevas acciones: STOCK_REGISTRAR, STOCK_GET_ALL, STOCK_ELIMINAR,
//      GENERAR_CODIGO, STOCK_ACTUALIZAR_CANTIDADES
// ═══════════════════════════════════════════════════════════════════

const SECRET_KEY   = "VEREX_2026_PRO";
const OPENAI_KEY   = "TU_OPENAI_KEY_AQUI";           // ← pega aquí tu key de OpenAI
const IMAGEKIT_KEY = "TU_IMAGEKIT_PRIVATE_KEY_AQUI"; // ← pega aquí tu private key de ImageKit

const SS = SpreadsheetApp.getActiveSpreadsheet();

function hoja(nombre) { return SS.getSheetByName(nombre); }

function jsonResp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService
    .createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ── Helpers de stock ─────────────────────────────────────────────────
// "AN021T10" → "AN021"   |   "CO005" → "CO005"
function getCodigoBase_(codigo) {
  return String(codigo || "").replace(/T\d+$/i, "").trim();
}
// "AN021T10" → "10"   |   "CO005" → ""
function getTallaFromCodigo_(codigo) {
  const m = String(codigo || "").match(/T(\d+)$/i);
  return m ? m[1] : "";
}

// ── GET ──────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const productos = sheetToObjects(hoja("productos")).filter(p =>
      p.activo !== false && p.activo !== "FALSE" && p.activo !== 0
    );
    const cupones = sheetToObjects(hoja("cupones")).map(c => ({
      ...c, activo: c.activo === true || c.activo === "TRUE" || c.activo === 1
    }));
    const pedidos  = sheetToObjects(hoja("pedidos"));
    const clientes = sheetToObjects(hoja("clientes"));
    const configRaw = sheetToObjects(hoja("config"));
    const config = {};
    configRaw.forEach(r => {
      try { config[r.clave] = JSON.parse(r.valor); }
      catch(_) { config[r.clave] = r.valor; }
    });
    return jsonResp({ productos, cupones, pedidos, clientes, config });
  } catch(e) {
    return jsonResp({ error: e.toString() });
  }
}

// ── POST ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.key !== SECRET_KEY) return jsonResp({ error: "No autorizado" });

    switch (d.accion) {

      // ════════════════════════════════════════════════════════════════
      //  STOCK — gestión de inventario por talla
      // ════════════════════════════════════════════════════════════════

      // ── GENERAR CÓDIGO BASE ──────────────────────────────────────
      // Recibe: { categoria } → devuelve el siguiente código base disponible
      // Ejemplo: categoria "AN" → "AN022" si "AN021" ya existe
      case "GENERAR_CODIGO": {
        const hStock = hoja("stock");
        const prefijo = String(d.categoria || "GEN").toUpperCase().slice(0, 2);
        let maxNum = 0;
        if (hStock) {
          const rows = hStock.getDataRange().getValues();
          if (rows.length > 1) {
            const headers = rows[0];
            const iBase = headers.indexOf("codigoBase");
            rows.slice(1).forEach(row => {
              const base = String(row[iBase] || "");
              if (base.startsWith(prefijo)) {
                const num = parseInt(base.replace(prefijo, "")) || 0;
                if (num > maxNum) maxNum = num;
              }
            });
          }
        }
        // También revisar en consignacion por si hay productos sin hoja stock
        const hCons = hoja("consignacion");
        if (hCons) {
          const rows = hCons.getDataRange().getValues();
          if (rows.length > 1) {
            const headers = rows[0];
            const iBase = headers.indexOf("codigoBase");
            if (iBase >= 0) {
              rows.slice(1).forEach(row => {
                const base = String(row[iBase] || "");
                if (base.startsWith(prefijo)) {
                  const num = parseInt(base.replace(prefijo, "")) || 0;
                  if (num > maxNum) maxNum = num;
                }
              });
            } else {
              // Fallback: revisar columna codigo
              const iCod = headers.indexOf("codigo");
              rows.slice(1).forEach(row => {
                const cod = getCodigoBase_(String(row[iCod] || ""));
                if (cod.startsWith(prefijo)) {
                  const num = parseInt(cod.replace(prefijo, "")) || 0;
                  if (num > maxNum) maxNum = num;
                }
              });
            }
          }
        }
        const siguienteNum = String(maxNum + 1).padStart(3, "0");
        const codigoBase   = prefijo + siguienteNum;
        return jsonResp({ ok: true, codigo: codigoBase });
      }

      // ── REGISTRAR / ACTUALIZAR STOCK ─────────────────────────────
      // Recibe: { codigo, codigoBase, talla, nombre, nombre_base,
      //           categoria, precio, foto, cantidad,
      //           descripcion, descripcionTienda }
      // Si el código ya existe: suma cantidad a stock_bodega y actualiza metadatos.
      // Si no existe: crea nueva fila.
      case "STOCK_REGISTRAR": {
        const hStock = hoja("stock") || SS.insertSheet("stock");

        // Asegurar encabezados
        const HEADERS_STOCK = [
          "codigo","codigoBase","talla","nombre","nombre_base",
          "categoria","precio","foto","descripcion","descripcionTienda",
          "estado","stock_bodega","stock_tienda","stock_consignacion",
          "stock_vendido","fechaRegistro"
        ];
        let allData = hStock.getDataRange().getValues();
        if (allData.length === 0 || allData[0][0] !== "codigo") {
          hStock.clearContents();
          hStock.appendRow(HEADERS_STOCK);
          allData = [HEADERS_STOCK];
        }

        const headers  = allData[0];
        const iCod     = headers.indexOf("codigo");
        const iBase    = headers.indexOf("codigoBase");
        const iTalla   = headers.indexOf("talla");
        const iNom     = headers.indexOf("nombre");
        const iNomBase = headers.indexOf("nombre_base");
        const iCat     = headers.indexOf("categoria");
        const iPrecio  = headers.indexOf("precio");
        const iFoto    = headers.indexOf("foto");
        const iDesc    = headers.indexOf("descripcion");
        const iDescT   = headers.indexOf("descripcionTienda");
        const iEstado  = headers.indexOf("estado");
        const iBodega  = headers.indexOf("stock_bodega");
        const iTienda  = headers.indexOf("stock_tienda");
        const iConsig  = headers.indexOf("stock_consignacion");
        const iVendido = headers.indexOf("stock_vendido");
        const iFecha   = headers.indexOf("fechaRegistro");

        const cantidad = parseInt(d.cantidad) || 0;
        let filaExistente = -1;
        allData.slice(1).forEach((row, ri) => {
          if (String(row[iCod]) === String(d.codigo)) filaExistente = ri + 2;
        });

        if (filaExistente > 0) {
          // Actualizar: sumar stock_bodega, refrescar metadatos
          const filaActual = allData[filaExistente - 1];
          const bodegaActual = parseInt(filaActual[iBodega]) || 0;
          hStock.getRange(filaExistente, iBodega  + 1).setValue(bodegaActual + cantidad);
          if (d.precio   !== undefined) hStock.getRange(filaExistente, iPrecio  + 1).setValue(parseFloat(d.precio) || 0);
          if (d.foto     !== undefined) hStock.getRange(filaExistente, iFoto    + 1).setValue(d.foto    || "");
          if (d.nombre   !== undefined) hStock.getRange(filaExistente, iNom     + 1).setValue(d.nombre  || "");
          if (d.nombre_base !== undefined) hStock.getRange(filaExistente, iNomBase + 1).setValue(d.nombre_base || "");
          if (d.descripcion !== undefined) hStock.getRange(filaExistente, iDesc   + 1).setValue(d.descripcion || "");
          if (d.descripcionTienda !== undefined) hStock.getRange(filaExistente, iDescT + 1).setValue(d.descripcionTienda || "");
        } else {
          // Nueva fila
          const nuevaFila = new Array(HEADERS_STOCK.length).fill("");
          nuevaFila[iCod]     = String(d.codigo     || "");
          nuevaFila[iBase]    = String(d.codigoBase  || getCodigoBase_(d.codigo));
          nuevaFila[iTalla]   = String(d.talla       || getTallaFromCodigo_(d.codigo));
          nuevaFila[iNom]     = String(d.nombre      || "");
          nuevaFila[iNomBase] = String(d.nombre_base || d.nombre || "");
          nuevaFila[iCat]     = String(d.categoria   || "");
          nuevaFila[iPrecio]  = parseFloat(d.precio) || 0;
          nuevaFila[iFoto]    = String(d.foto        || "");
          nuevaFila[iDesc]    = String(d.descripcion || "");
          nuevaFila[iDescT]   = String(d.descripcionTienda || "");
          nuevaFila[iEstado]  = "bodega";
          nuevaFila[iBodega]  = cantidad;
          nuevaFila[iTienda]  = 0;
          nuevaFila[iConsig]  = 0;
          nuevaFila[iVendido] = 0;
          nuevaFila[iFecha]   = new Date();
          hStock.appendRow(nuevaFila);
        }
        return jsonResp({ ok: true });
      }

      // ── OBTENER TODO EL STOCK ────────────────────────────────────
      // Devuelve todos los registros de la hoja stock
      case "STOCK_GET_ALL": {
        const hStock = hoja("stock");
        if (!hStock) return jsonResp({ ok: true, stock: [] });
        const rows = sheetToObjects(hStock);
        return jsonResp({ ok: true, stock: rows });
      }

      // ── ELIMINAR PRODUCTO DEL STOCK ──────────────────────────────
      // Recibe: { codigo } — elimina la fila con ese código exacto.
      // Para eliminar todas las tallas de un producto base:
      //   envía { codigoBase: "AN-021" } en vez de codigo.
      case "STOCK_ELIMINAR": {
        const hStock = hoja("stock");
        if (!hStock) return jsonResp({ ok: true });
        const all    = hStock.getDataRange().getValues();
        const headers = all[0];
        const iCod   = headers.indexOf("codigo");
        const iBase  = headers.indexOf("codigoBase");

        // Borrar de abajo hacia arriba para no desplazar índices
        for (let ri = all.length - 1; ri >= 1; ri--) {
          const rowCod  = String(all[ri][iCod]  || "");
          const rowBase = String(all[ri][iBase] || "");
          const match   = d.codigo
            ? rowCod === String(d.codigo)
            : d.codigoBase
              ? rowBase === String(d.codigoBase) || getCodigoBase_(rowCod) === String(d.codigoBase)
              : false;
          if (match) hStock.deleteRow(ri + 1);
        }
        return jsonResp({ ok: true });
      }

      // ── ACTUALIZAR CANTIDADES DE STOCK ───────────────────────────
      // Recibe: { codigo, delta_bodega, delta_tienda, delta_consignacion, delta_vendido }
      // Los deltas pueden ser negativos (quitar) o positivos (agregar).
      // Solo se aplican los deltas que vengan definidos.
      case "STOCK_ACTUALIZAR_CANTIDADES": {
        const hStock = hoja("stock");
        if (!hStock) return jsonResp({ ok: false, error: "Hoja stock no existe" });
        const all     = hStock.getDataRange().getValues();
        const headers = all[0];
        const iCod    = headers.indexOf("codigo");
        const iBodega = headers.indexOf("stock_bodega");
        const iTienda = headers.indexOf("stock_tienda");
        const iConsig = headers.indexOf("stock_consignacion");
        const iVend   = headers.indexOf("stock_vendido");
        const iEst    = headers.indexOf("estado");

        all.slice(1).forEach((row, ri) => {
          if (String(row[iCod]) !== String(d.codigo)) return;
          const fila = ri + 2;
          if (d.delta_bodega       !== undefined) {
            const v = Math.max(0, (parseInt(row[iBodega]) || 0) + parseInt(d.delta_bodega));
            hStock.getRange(fila, iBodega + 1).setValue(v);
          }
          if (d.delta_tienda       !== undefined) {
            const v = Math.max(0, (parseInt(row[iTienda]) || 0) + parseInt(d.delta_tienda));
            hStock.getRange(fila, iTienda + 1).setValue(v);
          }
          if (d.delta_consignacion !== undefined) {
            const v = Math.max(0, (parseInt(row[iConsig]) || 0) + parseInt(d.delta_consignacion));
            hStock.getRange(fila, iConsig + 1).setValue(v);
          }
          if (d.delta_vendido      !== undefined) {
            const v = Math.max(0, (parseInt(row[iVend]) || 0) + parseInt(d.delta_vendido));
            hStock.getRange(fila, iVend + 1).setValue(v);
          }
          // Actualizar estado automáticamente según cantidades
          if (d.estado !== undefined) {
            hStock.getRange(fila, iEst + 1).setValue(d.estado);
          }
        });
        return jsonResp({ ok: true });
      }

      // ════════════════════════════════════════════════════════════════
      //  PEDIDOS
      // ════════════════════════════════════════════════════════════════

      // ── PEDIDO NUEVO ────────────────────────────────────────────
      case "NUEVO_PEDIDO": {
        const hPed   = hoja("pedidos");
        const now    = new Date();
        const dia    = String(now.getDate()).padStart(2,'0');
        const mes    = String(now.getMonth()+1).padStart(2,'0');
        const prefijo = `#10${dia}${mes}`;
        const todosLosPedidos = hPed.getDataRange().getValues();
        const hoy = new Date(); hoy.setHours(0,0,0,0);
        let correlativo = 1;
        todosLosPedidos.slice(1).forEach(row => {
          const fechaFila = new Date(row[0]); fechaFila.setHours(0,0,0,0);
          if (fechaFila.getTime() === hoy.getTime()) correlativo++;
        });
        const numeroPedido = `${prefijo}-${String(correlativo).padStart(3,'0')}`;

        const hCli = hoja("clientes");
        const clientesData = hCli.getLastRow() > 1 ? hCli.getDataRange().getValues() : [hCli.getRange(1,1,1,8).getValues()[0]];
        const cliHeaders = clientesData[0] || [];
        const cliRows    = clientesData.length > 1 ? clientesData.slice(1) : [];
        const iTel       = cliHeaders.indexOf("telefono");
        const iCod       = cliHeaders.indexOf("codigo");
        const iTotal     = cliHeaders.indexOf("totalPedidos");
        let codigoCliente = "";
        let clienteExiste = false;
        let clienteRowIdx = -1;
        if (iTel >= 0 && iCod >= 0) {
          cliRows.forEach((row, ri) => {
            if (String(row[iTel]) === String(d.telefono)) {
              clienteExiste = true;
              clienteRowIdx = ri + 2;
              codigoCliente = String(row[iCod] || "");
              const totalActual = parseInt(row[iTotal]) || 0;
              hCli.getRange(clienteRowIdx, iTotal + 1).setValue(totalActual + 1);
            }
          });
        }
        if (!clienteExiste) {
          const numClientes = hCli.getLastRow();
          codigoCliente = "CVX-" + String(numClientes).padStart(3,'0');
          hCli.appendRow([codigoCliente, d.cliente, d.telefono, d.municipio, d.direccion, 1, new Date(), d.departamento || ""]);
        }
        codigoCliente = codigoCliente || "";
        hPed.appendRow([
          new Date(), numeroPedido, d.cliente, d.telefono, d.municipio,
          d.direccion, d.productos, d.total, "Pendiente", d.metodoPago || "", d.items || "",
          d.cuponUsado || "", d.descMonto || 0, d.envio || 0,
          d.telLlamada || "", d.correo || "", d.departamento || ""
        ]);
        const respuestaNumeroPedido = numeroPedido;
        if (d.correo) {
          try {
            GmailApp.sendEmail(d.correo, "Confirmacion de pedido VEREX - " + numeroPedido, "", {
              htmlBody: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
                <h2 style="text-align:center;letter-spacing:2px;">VEREX</h2>
                <p>Hola <b>${d.cliente}</b>,</p>
                <p>Tu pedido ha sido registrado exitosamente.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">N° Pedido</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:700;">${numeroPedido}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">Productos</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.productos}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">Total</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:700;">${d.total}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;">Pago</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.metodoPago}</td></tr>
                  <tr><td style="padding:8px;color:#888;">Tu código de cliente</td><td style="padding:8px;font-weight:700;color:#111;">${codigoCliente}</td></tr>
                </table>
                <p style="color:#888;font-size:13px;">Te contactaremos pronto por WhatsApp para coordinar la entrega.</p>
                <p style="text-align:center;font-style:italic;color:#aaa;margin-top:24px;">Gracias por tu compra. El mundo es mejor cuando tú brillas. ♡</p>
              </div>`
            });
          } catch(mailErr) {}
        }
        if (d.items) {
          const items = typeof d.items === "string" ? JSON.parse(d.items) : d.items;
          const h = hoja("productos");
          const [headers, ...rows] = h.getDataRange().getValues();
          const iCodP   = headers.indexOf("codigo");
          const iCaract = headers.indexOf("caracteristicas");
          items.forEach(item => {
            rows.forEach((row, ri) => {
              if (String(row[iCodP]) === String(item.codigo)) {
                try {
                  let stocks = JSON.parse(row[iCaract] || "{}");
                  const talla = String(item.tallaElegida || "");
                  const parejaMatch = talla.match(/Dama T(\d+).*Cab\. T(\d+)/i);
                  if (parejaMatch) {
                    const td = "D" + parejaMatch[1];
                    const th = "H" + parejaMatch[2];
                    if (stocks[td] > 0) stocks[td]--;
                    if (stocks[th] > 0) stocks[th]--;
                  } else {
                    const num = talla.replace(/[^0-9]/g,"");
                    if (num && stocks[num] > 0) stocks[num]--;
                  }
                  h.getRange(ri + 2, iCaract + 1).setValue(JSON.stringify(stocks));
                } catch(_) {}
              }
            });
          });
        }
        return jsonResp({ ok: true, numeroPedido: respuestaNumeroPedido, codigoCliente });
      }

      // ── BUSCAR CLIENTE ───────────────────────────────────────────
      case "BUSCAR_CLIENTE": {
        const hCli = hoja("clientes");
        const rows = sheetToObjects(hCli);
        const cliente = rows.find(r =>
          String(r.codigo).toUpperCase() === String(d.codigo).toUpperCase()
        );
        if (!cliente) return jsonResp({ ok: false, error: "Cliente no encontrado" });
        const hCup = hoja("cupones");
        const cupones = sheetToObjects(hCup);
        const cuponCliente = cupones.find(c =>
          String(c.codigoCliente||"").toUpperCase() === String(d.codigo).toUpperCase() &&
          (c.activo === true || c.activo === "TRUE" || c.activo === 1) &&
          (parseInt(c.limiteUsos) === 0 || parseInt(c.usosActuales||0) < parseInt(c.limiteUsos))
        );
        return jsonResp({ ok: true, cliente, cupon: cuponCliente || null });
      }

      // ── ELIMINAR PEDIDO ──────────────────────────────────────────
      case "ELIMINAR_PEDIDO": {
        const h = hoja("pedidos");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iNum = headers.indexOf("numeroPedido");
        for (let ri = rows.length - 1; ri >= 0; ri--) {
          if (String(rows[ri][iNum]) === String(d.numeroPedido)) { h.deleteRow(ri + 2); break; }
        }
        return jsonResp({ ok: true });
      }

      // ── CAMBIAR ESTADO PEDIDO ────────────────────────────────────
      case "ACTUALIZAR_ESTADO_PEDIDO": {
        const h = hoja("pedidos");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iCliente = headers.indexOf("cliente");
        const iFecha   = headers.indexOf("fecha");
        const iEstado  = headers.indexOf("estado");
        rows.forEach((row, ri) => {
          if (row[iCliente] === d.cliente && String(row[iFecha]) === String(d.fecha))
            h.getRange(ri + 2, iEstado + 1).setValue(d.estado);
        });
        return jsonResp({ ok: true });
      }

      // ════════════════════════════════════════════════════════════════
      //  PRODUCTOS (catálogo tienda online)
      // ════════════════════════════════════════════════════════════════

      // ── CREAR PRODUCTO ───────────────────────────────────────────
      case "CREAR_PRODUCTO": {
        hoja("productos").appendRow([Date.now(), d.nombre, d.codigo, parseFloat(d.precio), d.img, d.caracteristicas || "{}", true, false]);
        return jsonResp({ ok: true });
      }

      // ── EDITAR PRODUCTO ──────────────────────────────────────────
      case "EDITAR_PRODUCTO": {
        const h = hoja("productos");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iCod = headers.indexOf("codigo");
        rows.forEach((row, ri) => {
          if (String(row[iCod]) === String(d.codigo)) {
            const campos = { nombre:"nombre", precio:"precio", img:"img", caracteristicas:"caracteristicas", destacado:"destacado" };
            Object.entries(campos).forEach(([key, col]) => {
              if (d[key] !== undefined) {
                const idx = headers.indexOf(col);
                if (idx >= 0) h.getRange(ri + 2, idx + 1).setValue(key === "precio" ? parseFloat(d[key]) : d[key]);
              }
            });
          }
        });
        return jsonResp({ ok: true });
      }

      // ── DESACTIVAR PRODUCTO ──────────────────────────────────────
      case "ELIMINAR_PRODUCTO": {
        const h = hoja("productos");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iCod    = headers.indexOf("codigo");
        const iActivo = headers.indexOf("activo");
        rows.forEach((row, ri) => {
          if (String(row[iCod]) === String(d.codigo)) h.getRange(ri + 2, iActivo + 1).setValue(false);
        });
        return jsonResp({ ok: true });
      }

      // ════════════════════════════════════════════════════════════════
      //  CUPONES
      // ════════════════════════════════════════════════════════════════

      case "CREAR_CUPON": {
        hoja("cupones").appendRow([d.codigo, d.tipo || "porcentaje_total", parseFloat(d.descuento) || 0,
          d.categorias || "", parseFloat(d.montoMinimo) || 0, parseInt(d.limiteUsos) || 0, 0, true]);
        return jsonResp({ ok: true });
      }

      case "TOGGLE_CUPON": {
        const h = hoja("cupones");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iCod    = headers.indexOf("codigo");
        const iActivo = headers.indexOf("activo");
        rows.forEach((row, ri) => {
          if (row[iCod] === d.codigo) h.getRange(ri + 2, iActivo + 1).setValue(d.activo);
        });
        return jsonResp({ ok: true });
      }

      case "USAR_CUPON": {
        const h = hoja("cupones");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iCod    = headers.indexOf("codigo");
        const iUsos   = headers.indexOf("usosActuales");
        const iLim    = headers.indexOf("limiteUsos");
        const iActivo = headers.indexOf("activo");
        rows.forEach((row, ri) => {
          if (row[iCod] === d.codigo) {
            const usos  = parseInt(row[iUsos]) || 0;
            const lim   = parseInt(row[iLim])  || 0;
            const nuevo = usos + 1;
            h.getRange(ri + 2, iUsos + 1).setValue(nuevo);
            if (lim > 0 && nuevo >= lim) h.getRange(ri + 2, iActivo + 1).setValue(false);
          }
        });
        return jsonResp({ ok: true });
      }

      case "ELIMINAR_CUPON": {
        const h = hoja("cupones");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iCod = headers.indexOf("codigo");
        for (let ri = rows.length - 1; ri >= 0; ri--) {
          if (rows[ri][iCod] === d.codigo) { h.deleteRow(ri + 2); break; }
        }
        return jsonResp({ ok: true });
      }

      // ════════════════════════════════════════════════════════════════
      //  CONFIG
      // ════════════════════════════════════════════════════════════════

      case "ACTUALIZAR_CONFIG": {
        const h = hoja("config");
        const [headers, ...rows] = h.getDataRange().getValues();
        const iClave = headers.indexOf("clave");
        const iValor = headers.indexOf("valor");
        Object.entries(d.config).forEach(([clave, valor]) => {
          const str = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
          let found = false;
          rows.forEach((row, ri) => {
            if (row[iClave] === clave) { h.getRange(ri + 2, iValor + 1).setValue(str); found = true; }
          });
          if (!found) h.appendRow([clave, str]);
        });
        return jsonResp({ ok: true });
      }

      // ════════════════════════════════════════════════════════════════
      //  IA / IMÁGENES
      // ════════════════════════════════════════════════════════════════

      case "ANALIZAR_IMAGEN": {
        try {
          // El Worker inyecta openaiKey desde env.OPENAI_KEY (la key real no está en este script)
          const openaiKeyActual = d.openaiKey || OPENAI_KEY;
          const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + openaiKeyActual
            },
            payload: JSON.stringify({
              model: "gpt-4o-mini",
              max_tokens: 300,
              messages: [{
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: d.imagen } },
                  { type: "text", text: `Eres un experto catalogador de joyería para VEREX, tienda de joyería fina. Analiza la imagen con detalle y responde SOLO con el JSON indicado, sin texto adicional, sin markdown.

MATERIALES que manejamos (identifica cuál es por el color y brillo):
- Plata Fina 925: color blanco plateado brillante
- Plata 925 con Oro Laminado: combina tono dorado y plateado
- Acero 316L: plateado más opaco/gris, muy liso
- Oro Laminado: dorado uniforme
Si el material no es claro, escribe el más probable.

INSTRUCCIONES para cada campo:
- "nombre": máximo 4 palabras, descriptivo. Ejemplos: "Anillo floral zirconia", "Aretes argolla lisa", "Collar corazón colgante", "Pulsera eslabón cubano". NO incluyas talla ni material en el nombre.
- "descripcion": 10-20 palabras describiendo material, acabado, piedras, forma, estilo. Ejemplo: "Plata 925 con zirconias blancas, diseño floral delicado, acabado brillante pulido".
- "descripcion_tienda": frase atractiva de venta, 15-25 palabras para publicar en redes. Ejemplo: "Elegancia que dura toda la vida. Diseño floral en plata 925 con destellos de zirconia que iluminan tu look".
- "categoria": USA EXACTAMENTE uno de estos códigos según lo que ves: AN=anillo, PU=pulsera, CO=collar, AR=aretes, CJ=conjunto visible (anillo+aretes juntos en la foto), DJ=dije suelto, TB=tobillera, CD=cadena con dije, CA=cadena sola sin dije, RS=rosario, RE=reloj.

Responde ÚNICAMENTE con este JSON:
{"nombre":"...","descripcion":"...","descripcion_tienda":"...","categoria":"CODIGO"}` }
                ]
              }]
            }),
            muteHttpExceptions: true
          });
          const status = response.getResponseCode();
          if (status !== 200) return jsonResp({ ok: false, error: "OpenAI error " + status });
          const data   = JSON.parse(response.getContentText());
          const text   = data.choices?.[0]?.message?.content || "";
          const clean  = text.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(clean);
          return jsonResp({ ok: true, resultado: parsed });
        } catch(err) {
          return jsonResp({ ok: false, error: err.toString() });
        }
      }

      case "SUBIR_FOTO": {
        try {
          // El Worker inyecta imagekitKey desde env.IMAGEKIT_KEY
          const imagekitKeyActual = d.imagekitKey || IMAGEKIT_KEY;
          const boundary   = "----VerexBoundary" + Date.now();
          const base64Data = d.imagen.split(",")[1] || d.imagen;
          const fileName   = (d.nombre || "producto").replace(/\s+/g,"_") + "_" + Date.now() + ".jpg";
          const body = "--" + boundary + "\r\n"
            + 'Content-Disposition: form-data; name="file"\r\n\r\n'
            + base64Data + "\r\n"
            + "--" + boundary + "\r\n"
            + 'Content-Disposition: form-data; name="fileName"\r\n\r\n'
            + fileName + "\r\n"
            + "--" + boundary + "\r\n"
            + 'Content-Disposition: form-data; name="folder"\r\n\r\n'
            + "/consignacion\r\n"
            + "--" + boundary + "--";
          const response = UrlFetchApp.fetch("https://upload.imagekit.io/api/v1/files/upload", {
            method: "POST",
            headers: {
              "Authorization": "Basic " + Utilities.base64Encode(imagekitKeyActual + ":"),
              "Content-Type": "multipart/form-data; boundary=" + boundary
            },
            payload: body,
            muteHttpExceptions: true
          });
          const status = response.getResponseCode();
          if (status !== 200) return jsonResp({ ok: false, error: "ImageKit error " + status });
          const data = JSON.parse(response.getContentText());
          return jsonResp({ ok: true, url: data.url || null });
        } catch(err) {
          return jsonResp({ ok: false, error: err.toString() });
        }
      }

      // ════════════════════════════════════════════════════════════════
      //  CONSIGNACIÓN
      // ════════════════════════════════════════════════════════════════

      // ── REGISTRAR ENTREGA ────────────────────────────────────────
      // Columnas consignacion (v2):
      //   id | vendedor | codigo | nombre | codigoBase | talla | nombre_base |
      //   categoria | precio | cantidad | vendido | foto | fecha | estado
      case "REGISTRAR_ENTREGA": {
        const h = hoja("consignacion");
        const items = d.items || [];
        items.forEach(item => {
          const codigoBase = item.codigoBase || getCodigoBase_(item.codigo);
          const talla      = item.talla      || getTallaFromCodigo_(item.codigo) || "";
          const nombreBase = item.nombre_base || (item.nombre || "").replace(/ T\d+$/i, "").trim() || item.nombre;
          h.appendRow([
            item.id,
            d.vendedor,
            item.codigo,
            item.nombre,
            codigoBase,
            talla,
            nombreBase,
            item.categoria,
            item.precio,
            item.cantidad,
            0,
            item.foto || "",
            new Date(),
            "activo"
          ]);
          // Actualizar hoja stock: reducir bodega, aumentar consignacion
          try {
            const hStock = hoja("stock");
            if (hStock) {
              const allStock = hStock.getDataRange().getValues();
              const sHeaders = allStock[0];
              const siCod    = sHeaders.indexOf("codigo");
              const siBodega = sHeaders.indexOf("stock_bodega");
              const siConsig = sHeaders.indexOf("stock_consignacion");
              allStock.slice(1).forEach((row, ri) => {
                if (String(row[siCod]) === String(item.codigo)) {
                  const fila    = ri + 2;
                  const bodega  = Math.max(0, (parseInt(row[siBodega]) || 0) - (parseInt(item.cantidad) || 0));
                  const consig  = (parseInt(row[siConsig]) || 0) + (parseInt(item.cantidad) || 0);
                  hStock.getRange(fila, siBodega + 1).setValue(bodega);
                  hStock.getRange(fila, siConsig + 1).setValue(consig);
                }
              });
            }
          } catch(stockErr) {}
        });

        // Actualizar totalEntregado del vendedor
        const hV = hoja("vendedores");
        const vRows = hV.getDataRange().getValues();
        const vHeaders = vRows[0];
        const viCod = vHeaders.indexOf("codigo");
        const viEnt = vHeaders.indexOf("totalEntregado");
        vRows.slice(1).forEach((row, ri) => {
          if (String(row[viCod]) === String(d.vendedor)) {
            const total = items.reduce((s, i) => s + (parseInt(i.cantidad) || 0), 0);
            hV.getRange(ri + 2, viEnt + 1).setValue((parseInt(row[viEnt]) || 0) + total);
          }
        });
        return jsonResp({ ok: true });
      }

      // ── REGISTRAR ENTREGA PENDIENTE (para confirmación del vendedor)
      case "REGISTRAR_ENTREGA_PENDIENTE": {
        let hEnt = hoja("entregas");
        if (!hEnt) {
          hEnt = SS.insertSheet("entregas");
          hEnt.getRange(1,1,1,6).setValues([["id","vendedor","fecha","items","estado","codigoRecibo"]]);
        } else if (hEnt.getLastRow() === 0) {
          hEnt.getRange(1,1,1,6).setValues([["id","vendedor","fecha","items","estado","codigoRecibo"]]);
        }
        const items = d.items || [];
        const itemsJSON = JSON.stringify(items.map(i => ({
          codigo: i.codigo, nombre: i.nombre, precio: i.precio, foto: i.foto || ""
        })));
        hEnt.appendRow([
          d.id || String(Date.now()),
          d.vendedor || "",
          new Date(),
          itemsJSON,
          "pendiente",
          d.codigoRecibo || ""
        ]);
        return jsonResp({ ok: true });
      }

      // ── REGISTRAR VENTA ──────────────────────────────────────────
      case "REGISTRAR_VENTA": {
        const h = hoja("consignacion");
        const all = h.getDataRange().getValues();
        const headers = all[0];
        const iId      = headers.indexOf("id");
        const iCod     = headers.indexOf("codigo");
        const iVendido = headers.indexOf("vendido");
        const iCantid  = headers.indexOf("cantidad");
        const iEstado  = headers.indexOf("estado");
        all.slice(1).forEach((row, ri) => {
          if (String(row[iId]) === String(d.id)) {
            const vendidoActual = parseInt(row[iVendido]) || 0;
            const nuevoVendido  = vendidoActual + (parseInt(d.cantidad) || 1);
            h.getRange(ri + 2, iVendido + 1).setValue(nuevoVendido);
            const cantTotal = parseInt(row[iCantid]) || 0;
            if (nuevoVendido >= cantTotal) h.getRange(ri + 2, iEstado + 1).setValue("vendido");
            // Actualizar hoja stock
            try {
              const codigo = String(row[iCod] || "");
              const hStock = hoja("stock");
              if (hStock && codigo) {
                const allStock = hStock.getDataRange().getValues();
                const sHeaders = allStock[0];
                const siCod    = sHeaders.indexOf("codigo");
                const siConsig = sHeaders.indexOf("stock_consignacion");
                const siVend   = sHeaders.indexOf("stock_vendido");
                allStock.slice(1).forEach((sRow, sri) => {
                  if (String(sRow[siCod]) === codigo) {
                    const fila    = sri + 2;
                    const qty     = parseInt(d.cantidad) || 1;
                    const consig  = Math.max(0, (parseInt(sRow[siConsig]) || 0) - qty);
                    const vendido = (parseInt(sRow[siVend]) || 0) + qty;
                    hStock.getRange(fila, siConsig + 1).setValue(consig);
                    hStock.getRange(fila, siVend   + 1).setValue(vendido);
                  }
                });
              }
            } catch(stockErr) {}
          }
        });
        return jsonResp({ ok: true });
      }

      // ── REGISTRAR VENTA VENDEDOR (alias desde inventario-sellers) ─
      // Igual a REGISTRAR_VENTA pero devuelve ventaId
      case "REGISTRAR_VENTA_VENDEDOR": {
        const h = hoja("consignacion");
        const all = h.getDataRange().getValues();
        const headers = all[0];
        const iId      = headers.indexOf("id");
        const iCod     = headers.indexOf("codigo");
        const iVendido = headers.indexOf("vendido");
        const iCantid  = headers.indexOf("cantidad");
        const iEstado  = headers.indexOf("estado");
        let ventaId = null;
        all.slice(1).forEach((row, ri) => {
          if (String(row[iId]) === String(d.id)) {
            const vendidoActual = parseInt(row[iVendido]) || 0;
            const nuevoVendido  = vendidoActual + (parseInt(d.cantidad) || 1);
            h.getRange(ri + 2, iVendido + 1).setValue(nuevoVendido);
            const cantTotal = parseInt(row[iCantid]) || 0;
            if (nuevoVendido >= cantTotal) h.getRange(ri + 2, iEstado + 1).setValue("vendido");
            ventaId = String(row[iId]);
            // Actualizar hoja stock
            try {
              const codigo = String(row[iCod] || "");
              const hStock = hoja("stock");
              if (hStock && codigo) {
                const allStock = hStock.getDataRange().getValues();
                const sHeaders = allStock[0];
                const siCod    = sHeaders.indexOf("codigo");
                const siConsig = sHeaders.indexOf("stock_consignacion");
                const siVend   = sHeaders.indexOf("stock_vendido");
                allStock.slice(1).forEach((sRow, sri) => {
                  if (String(sRow[siCod]) === codigo) {
                    const fila    = sri + 2;
                    const qty     = parseInt(d.cantidad) || 1;
                    const consig  = Math.max(0, (parseInt(sRow[siConsig]) || 0) - qty);
                    const vendido = (parseInt(sRow[siVend]) || 0) + qty;
                    hStock.getRange(fila, siConsig + 1).setValue(consig);
                    hStock.getRange(fila, siVend   + 1).setValue(vendido);
                  }
                });
              }
            } catch(stockErr) {}
          }
        });
        return jsonResp({ ok: true, ventaId });
      }

      // ── OBTENER DATOS CONSIGNACIÓN ───────────────────────────────
      case "GET_CONSIGNACION": {
        const vendedores   = sheetToObjects(hoja("vendedores"));
        const consignacion = sheetToObjects(hoja("consignacion"));
        return jsonResp({ ok: true, vendedores, consignacion });
      }

      // ── ENTREGAS PENDIENTES DE CONFIRMAR (vendedor) ───────────────
      case "GET_ENTREGAS_PENDIENTES": {
        const hEnt = hoja("entregas");
        if (!hEnt) return jsonResp({ ok: true, entregas: [] });
        const rows = sheetToObjects(hEnt);
        const entregas = rows
          .filter(r => String(r.vendedor) === String(d.vendedor) && r.estado === "pendiente")
          .map(r => ({
            id:    String(r.id),
            fecha: r.fecha,
            items: typeof r.items === "string" ? r.items : JSON.stringify(r.items || []),
            codigoRecibo: r.codigoRecibo || ""
          }));
        return jsonResp({ ok: true, entregas });
      }

      // ── CONFIRMAR RECEPCIÓN DE ENTREGA (vendedor firma) ──────────
      case "CONFIRMAR_ENTREGA_RECIBO": {
        const hEnt = hoja("entregas");
        if (!hEnt) return jsonResp({ ok: false, error: "Hoja entregas no encontrada" });
        const allEnt = hEnt.getDataRange().getValues();
        const hd     = allEnt[0];
        const hiId      = hd.indexOf("id");
        const hiEstado  = hd.indexOf("estado");
        const hiCodRec  = hd.indexOf("codigoRecibo");
        let confirmado  = false;
        allEnt.slice(1).forEach((row, ri) => {
          if (String(row[hiId]) === String(d.id)) {
            // Verificar código de recibo
            const codigoEsperado = String(row[hiCodRec] || "").toUpperCase();
            const codigoIngresado = String(d.codigoRecibo || "").toUpperCase();
            if (codigoEsperado && codigoEsperado !== codigoIngresado) return;
            hEnt.getRange(ri + 2, hiEstado + 1).setValue("confirmado");
            confirmado = true;
          }
        });
        if (!confirmado) return jsonResp({ ok: false, error: "Código de recibo incorrecto o entrega no encontrada" });
        return jsonResp({ ok: true });
      }

      // ── VENTAS DEL VENDEDOR ───────────────────────────────────────
      case "GET_VENTAS_VENDEDOR": {
        const hCons = hoja("consignacion");
        if (!hCons) return jsonResp({ ok: true, ventas: [] });
        const rows = sheetToObjects(hCons);
        // Devolver los productos del vendedor que tienen vendido > 0
        const ventas = rows
          .filter(r => String(r.vendedor) === String(d.vendedor) && (parseInt(r.vendido) || 0) > 0)
          .map(r => ({
            id:       String(r.id),
            codigo:   r.codigo,
            nombre:   r.nombre,
            precio:   r.precio,
            foto:     r.foto || "",
            cantidad: parseInt(r.vendido) || 0,
            fecha:    r.fecha
          }));
        return jsonResp({ ok: true, ventas });
      }

      // ── SOLICITAR CORRECCIÓN DE VENTA ─────────────────────────────
      case "SOLICITAR_CORRECCION_VENTA": {
        try {
          let hSol = hoja("solicitudes");
          if (!hSol) {
            hSol = SS.insertSheet("solicitudes");
            hSol.getRange(1,1,1,6).setValues([["fecha","tipo","ventaId","vendedor","vendedorNombre","motivo"]]);
          }
          hSol.appendRow([new Date(), "correccion_venta", d.ventaId || "", d.vendedor || "", d.vendedorNombre || "", d.motivo || ""]);
        } catch(e) {}
        return jsonResp({ ok: true });
      }

      // ── GUARDAR VENDEDOR ─────────────────────────────────────────
      case "GUARDAR_VENDEDOR": {
        const h = hoja("vendedores");
        const rows = sheetToObjects(h);
        const existe = rows.find(r => String(r.codigo) === String(d.vendedor.codigo));
        if (existe) {
          const all = h.getDataRange().getValues();
          const headers = all[0];
          all.slice(1).forEach((row, ri) => {
            if (String(row[headers.indexOf("codigo")]) === String(d.vendedor.codigo)) {
              Object.keys(d.vendedor).forEach(key => {
                const ci = headers.indexOf(key);
                if (ci >= 0) h.getRange(ri + 2, ci + 1).setValue(d.vendedor[key]);
              });
            }
          });
        } else {
          const v = d.vendedor;
          h.appendRow([v.codigo, v.nombre, v.telefono, 0, 0, new Date(), ""]);
        }
        return jsonResp({ ok: true });
      }

      // ── GUARDAR TOKEN ────────────────────────────────────────────
      case "GUARDAR_TOKEN": {
        const h = hoja("vendedores");
        const all = h.getDataRange().getValues();
        const headers = all[0];
        const iCod   = headers.indexOf("codigo");
        const iToken = headers.indexOf("tokenInventario");
        if (iToken < 0) return jsonResp({ ok: false, error: "Columna tokenInventario no existe" });
        all.slice(1).forEach((row, ri) => {
          if (String(row[iCod]) === String(d.vendedor))
            h.getRange(ri + 2, iToken + 1).setValue(d.token);
        });
        return jsonResp({ ok: true });
      }

      // ── VERIFICAR TOKEN ──────────────────────────────────────────
      case "VERIFICAR_TOKEN": {
        const h = hoja("vendedores");
        const rows = sheetToObjects(h);
        const v = rows.find(r => String(r.codigo) === String(d.vendedor));
        if (!v) return jsonResp({ ok: false });
        return jsonResp({ ok: String(v.tokenInventario) === String(d.token), vendedor: v });
      }

      // ── GUARDAR HISTORIAL CORTE ──────────────────────────────────
      case "GUARDAR_CORTE_HISTORIAL": {
        const h = hoja("cortesHistorial");
        h.appendRow([d.id, d.vendedor, new Date(), d.totalVendido, d.comisionPct, d.gananciaVendedor, d.aPagarVerex]);
        return jsonResp({ ok: true });
      }

      // ── OBTENER HISTORIAL CORTES ─────────────────────────────────
      case "GET_HISTORIAL_CORTES": {
        const rows = sheetToObjects(hoja("cortesHistorial"));
        const historial = rows.filter(r => String(r.vendedor) === String(d.vendedor));
        return jsonResp({ ok: true, historial });
      }

      // ── CERRAR CORTE ─────────────────────────────────────────────
      case "CERRAR_CORTE": {
        const h = hoja("consignacion");
        const all = h.getDataRange().getValues();
        const headers = all[0];
        const iId     = headers.indexOf("id");
        const iCod    = headers.indexOf("codigo");
        const iCant   = headers.indexOf("cantidad");
        const iVend   = headers.indexOf("vendido");
        const iEstado = headers.indexOf("estado");

        (d.devueltos || []).forEach(id => {
          all.slice(1).forEach((row, ri) => {
            if (String(row[iId]) === String(id)) {
              h.getRange(ri + 2, iEstado + 1).setValue("devuelto");
              // Regresar a bodega en hoja stock
              try {
                const codigo = String(row[iCod] || "");
                const cantTotal = parseInt(row[iCant]) || 0;
                const cantVend  = parseInt(row[iVend]) || 0;
                const aDevolver = Math.max(0, cantTotal - cantVend);
                const hStock = hoja("stock");
                if (hStock && codigo && aDevolver > 0) {
                  const allStock = hStock.getDataRange().getValues();
                  const sHeaders = allStock[0];
                  const siCod    = sHeaders.indexOf("codigo");
                  const siBodega = sHeaders.indexOf("stock_bodega");
                  const siConsig = sHeaders.indexOf("stock_consignacion");
                  allStock.slice(1).forEach((sRow, sri) => {
                    if (String(sRow[siCod]) === codigo) {
                      const fila   = sri + 2;
                      const bodega = (parseInt(sRow[siBodega]) || 0) + aDevolver;
                      const consig = Math.max(0, (parseInt(sRow[siConsig]) || 0) - aDevolver);
                      hStock.getRange(fila, siBodega + 1).setValue(bodega);
                      hStock.getRange(fila, siConsig + 1).setValue(consig);
                    }
                  });
                }
              } catch(stockErr) {}
            }
          });
        });

        const hV = hoja("vendedores");
        const vRows = hV.getDataRange().getValues();
        const vHeaders = vRows[0];
        vRows.slice(1).forEach((row, ri) => {
          if (String(row[vHeaders.indexOf("codigo")]) === String(d.vendedor)) {
            hV.getRange(ri + 2, vHeaders.indexOf("totalVendido") + 1).setValue(0);
            hV.getRange(ri + 2, vHeaders.indexOf("fechaCorte")   + 1).setValue(new Date());
          }
        });
        return jsonResp({ ok: true });
      }

      // ── REGISTRAR DEVOLUCIÓN ─────────────────────────────────────
      // Recibe: { vendedor, items: [{id, codigo, cantidad}] }
      // Por cada item: reduce cantidad en consignacion, suma a stock_bodega,
      // reduce stock_consignacion, marca estado "devuelto" si no quedan disponibles
      case "REGISTRAR_DEVOLUCION": {
        const hCons  = hoja("consignacion");
        const hStock = hoja("stock");
        const allCons = hCons.getDataRange().getValues();
        const hdrCons = allCons[0];
        const ciId      = hdrCons.indexOf("id");
        const ciCant    = hdrCons.indexOf("cantidad");
        const ciVendido = hdrCons.indexOf("vendido");
        const ciEstado  = hdrCons.indexOf("estado");
        const ciCod     = hdrCons.indexOf("codigo");

        const items = d.items || [];
        items.forEach(item => {
          const devQty = parseInt(item.cantidad) || 0;
          if (devQty <= 0) return;
          // Actualizar fila en consignacion
          allCons.slice(1).forEach((row, ri) => {
            if (String(row[ciId]) !== String(item.id)) return;
            const cantActual  = parseInt(row[ciCant])    || 0;
            const vendido     = parseInt(row[ciVendido]) || 0;
            const nuevaCant   = Math.max(vendido, cantActual - devQty);
            const fila        = ri + 2;
            hCons.getRange(fila, ciCant + 1).setValue(nuevaCant);
            if (nuevaCant <= vendido) {
              hCons.getRange(fila, ciEstado + 1).setValue("devuelto");
            }
            // Actualizar hoja stock
            if (hStock) {
              const allStock  = hStock.getDataRange().getValues();
              const sHdr      = allStock[0];
              const siCod     = sHdr.indexOf("codigo");
              const siBodega  = sHdr.indexOf("stock_bodega");
              const siConsig  = sHdr.indexOf("stock_consignacion");
              allStock.slice(1).forEach((sRow, sri) => {
                if (String(sRow[siCod]) !== String(row[ciCod])) return;
                const sFila  = sri + 2;
                const bodega = (parseInt(sRow[siBodega]) || 0) + devQty;
                const consig = Math.max(0, (parseInt(sRow[siConsig]) || 0) - devQty);
                hStock.getRange(sFila, siBodega + 1).setValue(bodega);
                hStock.getRange(sFila, siConsig + 1).setValue(consig);
              });
            }
          });
        });
        // Guardar registro en hoja devoluciones
        let hDev = SS.getSheetByName("devoluciones");
        if (!hDev) {
          hDev = SS.insertSheet("devoluciones");
          hDev.appendRow(["id","vendedor","fecha","items","total_unidades"]);
        }
        const devId   = "DEV-" + Date.now();
        const fecha   = new Date().toISOString();
        const totalU  = items.reduce((s, i) => s + (parseInt(i.cantidad)||0), 0);
        hDev.appendRow([devId, d.vendedor, fecha, JSON.stringify(items), totalU]);
        return jsonResp({ ok: true, devolucionId: devId, fecha });
      }

      // ── GET DEVOLUCIONES VENDEDOR ────────────────────────────────
      case "GET_DEVOLUCIONES_VENDEDOR": {
        const hDev = SS.getSheetByName("devoluciones");
        if (!hDev) return jsonResp({ ok: true, devoluciones: [] });
        const rows = hDev.getDataRange().getValues();
        const hdr  = rows[0];
        const devs = rows.slice(1).map(r => {
          const obj = {};
          hdr.forEach((h, i) => obj[h] = r[i]);
          try { obj.items = JSON.parse(obj.items); } catch(e) { obj.items = []; }
          return obj;
        }).filter(r => String(r.vendedor) === String(d.vendedor));
        return jsonResp({ ok: true, devoluciones: devs });
      }

      // ── ELIMINAR ITEM CONSIGNACIÓN ───────────────────────────────
      case "ELIMINAR_ITEM_CONSIGNACION": {
        const h = hoja("consignacion");
        const all = h.getDataRange().getValues();
        const headers = all[0];
        const iId  = headers.indexOf("id");
        const iCod = headers.indexOf("codigo");
        const iCnt = headers.indexOf("cantidad");
        const iVnd = headers.indexOf("vendido");
        for (let ri = all.length - 1; ri >= 1; ri--) {
          if (String(all[ri][iId]) === String(d.id)) {
            // Devolver stock a bodega si queda sin vender
            try {
              const codigo     = String(all[ri][iCod] || "");
              const cantTotal  = parseInt(all[ri][iCnt]) || 0;
              const cantVend   = parseInt(all[ri][iVnd]) || 0;
              const aDevolver  = Math.max(0, cantTotal - cantVend);
              const hStock = hoja("stock");
              if (hStock && codigo && aDevolver > 0) {
                const allStock = hStock.getDataRange().getValues();
                const sHeaders = allStock[0];
                const siCod    = sHeaders.indexOf("codigo");
                const siBodega = sHeaders.indexOf("stock_bodega");
                const siConsig = sHeaders.indexOf("stock_consignacion");
                allStock.slice(1).forEach((sRow, sri) => {
                  if (String(sRow[siCod]) === codigo) {
                    const fila   = sri + 2;
                    const bodega = (parseInt(sRow[siBodega]) || 0) + aDevolver;
                    const consig = Math.max(0, (parseInt(sRow[siConsig]) || 0) - aDevolver);
                    hStock.getRange(fila, siBodega + 1).setValue(bodega);
                    hStock.getRange(fila, siConsig + 1).setValue(consig);
                  }
                });
              }
            } catch(stockErr) {}
            h.deleteRow(ri + 1);
            break;
          }
        }
        return jsonResp({ ok: true });
      }

      default:
        return jsonResp({ error: "Acción desconocida: " + d.accion });
    }
  } catch(err) {
    return jsonResp({ error: err.toString() });
  }
}
