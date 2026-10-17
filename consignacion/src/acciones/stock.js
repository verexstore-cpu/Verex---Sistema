// Inventario: stock, productos, códigos y categorías
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { _baseDeCodigo, _baseTrio, analizarCategorias, auditarStock, cambiarCodigos, categoriasTiendaActual, sugerirCodigos } from "../lib/codigos.js";
import { NO_MANEJADA, forbidden, json } from "../lib/http.js";
import { sanearConfigPublico, stockPublico } from "../lib/publico.js";
import { stockAsignarTiendaEnBloque, stockAsignarVendedorEnBloque, stockDevolverBodegaEnBloque } from "../lib/stock-bloque.js";

export async function accionesStock({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    // Inventario COMPLETO (publicado o no, con costos y consignación): solo admin.
    // Lo usan el Hub de consignación (apiPost manda _pass) y foto-qr.html (login con _pass).
    // El catálogo público usa GET_CATALOGO, que solo devuelve lo publicado.
    case "STOCK_GET_ALL": {
      if (!esAdmin) return forbidden();
      const docs = await sb.getAll("stock");
      // codigosInactivos: los códigos de productos eliminados SIGUEN ocupados en el servidor (nunca se reutilizan). El Hub
      // los suma al calcular el siguiente código; si no, proponía uno ya usado por un producto eliminado y lo rechazaba.
      result = { ok: true, stock: docs.filter(p => p.estado !== "inactivo"), codigosInactivos: docs.filter(p => p.estado === "inactivo").map(p => String(p.codigo || p.id || "")).filter(Boolean) };
      break;
    }

    // Solo lectura — "eliminar" en Stock nunca borra el registro, solo le
    // pone estado:"inactivo" (ver ELIMINAR_PRODUCTO), así que sigue en
    // Supabase pero STOCK_GET_ALL lo filtra. Esto existe para poder
    // auditar/recuperar info de productos que se eliminaron sin querer,
    // filtrando por código, código base, o nombre (coincidencia parcial).
    case "STOCK_GET_INACTIVOS": {
      if (!esAdmin) return forbidden();
      const q = String(d.q || "").trim().toLowerCase();
      const todos = await sb.getAll("stock");
      const inactivos = todos.filter(p => p.estado === "inactivo");
      result = {
        ok: true,
        stock: q ? inactivos.filter(p =>
          (p.codigo || "").toLowerCase().includes(q) ||
          (p.codigoBase || "").toLowerCase().includes(q) ||
          (p.nombre || "").toLowerCase().includes(q) ||
          (p.nombre_base || "").toLowerCase().includes(q)
        ) : inactivos
      };
      break;
    }

    case "STOCK_REGISTRAR": {
      if (!esAdmin) return forbidden();
      // Nunca guardar campos de control de la petición (contraseña, nombre de
      // acción, etc.) dentro del documento — GET_STOCK es público y los expondría.
      const limpiarControl = obj => {
        const { _pass, accion, items, ...limpio } = obj;
        return limpio;
      };
      const items = (Array.isArray(d.items) ? d.items : [d]).map(limpiarControl);
      const codigos = [];
      // Cargar stock UNA sola vez fuera del loop (evita race condition y N queries)
      const allStockCache = await sb.getAll("stock");
      const codigosUsados = new Set(allStockCache.map(s => s.codigo));
      let conflictoCodigo = null, conflictoInactivo = null;
      const reactivados = [];
      for (const item of items) {
        // Auto-generar código si no viene o se pide
        let codigo = item.codigo;
        // «➕ Agregar talla» (Nexus): si ese código existe pero se ELIMINÓ (inactivo), se reactiva con la cantidad nueva
        // en vez de rechazarlo. Nunca uno que quedó inactivo por un cambio de código (reemplazadoPor): ese ya vive en otro.
        const reactivarSiInactivo = item.reactivarSiInactivo === true;
        delete item.reactivarSiInactivo;
        let previoInactivo = null;
        if (codigo && !item.autoGenerarCodigo && codigosUsados.has(codigo) && !codigos.includes(codigo)) {
          const previo = allStockCache.find(s => s.codigo === codigo || s.id === codigo);
          if (previo && previo.estado === "inactivo") {
            if (reactivarSiInactivo && !previo.reemplazadoPor) previoInactivo = previo;
            else conflictoInactivo = previo;
          }
        }
        if (previoInactivo) {
          const qtyR = parseInt(item.cantidad) || 1;
          const { id: _idR, ...previoSinId } = previoInactivo;
          await sb.set("stock", codigo, {
            ...previoSinId, ...item, codigo,
            precio:             Math.round((parseFloat(item.precio ?? previoInactivo.precio) || 0) * 100) / 100,
            estado:             "bodega",
            stock_bodega:       qtyR, stock_tienda: 0, stock_consignacion: 0, stock_reservado: 0, stock_total: qtyR,
            stock_vendido:      parseInt(previoInactivo.stock_vendido) || 0,
            fechaRegistro:      previoInactivo.fechaRegistro || new Date().toISOString(),
            reactivadoEn:       new Date().toISOString(),
          });
          codigos.push(codigo); reactivados.push(codigo);
          continue;
        }
        if (codigo && !item.autoGenerarCodigo) {
          // Código ya calculado del lado del cliente (Hub → "+Agregar" /
          // "Nueva Entrega") — sin esta verificación, si el stock local del
          // cliente estaba desactualizado o dos personas agregaron casi al
          // mismo tiempo, sb.set() de más abajo lo hubiera sobrescrito en
          // silencio (mismo código = mismo registro).
          if (codigosUsados.has(codigo)) { conflictoCodigo = codigo; break; }
          codigosUsados.add(codigo);
        }
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
      if (conflictoCodigo) {
        const ina = conflictoInactivo && (conflictoInactivo.codigo === conflictoCodigo || conflictoInactivo.id === conflictoCodigo) ? conflictoInactivo : null;
        result = { ok: false, error: ina
          ? (ina.reemplazadoPor ? `El código ${conflictoCodigo} ya no se usa: se cambió a ${ina.reemplazadoPor}.` : `El código ${conflictoCodigo} existe pero está eliminado (inactivo).`)
          : `El código ${conflictoCodigo} ya existe — alguien más lo generó justo antes. Vuelve a abrir el formulario para que se recalcule.` };
        break;
      }
      result = { ok: true, codigos, reactivados };
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

    // Limpieza única: purgar campos de control (contraseña, nombre de acción)
    // que quedaron guardados por error en filas de stock ya existentes.
    case "STOCK_LIMPIAR_CAMPOS_SENSIBLES": {
      if (!esAdmin) return forbidden();
      const todos = await sb.getAll("stock");
      const pendientes = todos.filter(p => p._pass !== undefined || p.accion !== undefined);
      const lote = pendientes.slice(0, parseInt(d.limit) || 40); // límite de subrequests por invocación
      for (const p of lote) {
        const { _pass, accion, id, ...limpio } = p;
        await sb.set("stock", p.id || p.codigo, limpio);
      }
      result = { ok: true, limpiados: lote.length, quedan: pendientes.length - lote.length, total: todos.length };
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

    case "AJUSTAR_STOCK_MANUAL": {
      if (!esAdmin) return forbidden();
      const { codigo: codAj, campo: campoAj, delta: deltaAj } = d;
      if (!codAj || !campoAj || deltaAj == null) { result = { ok: false, error: "Faltan parámetros: codigo, campo, delta" }; break; }
      const camposPermitidos = ["stock_bodega","stock_tienda","stock_reservado","stock_consignacion","stock_vendido"];
      if (!camposPermitidos.includes(campoAj)) { result = { ok: false, error: "Campo no permitido" }; break; }
      const sAj = await sb.get("stock", codAj);
      if (!sAj) { result = { ok: false, error: "Producto no encontrado en stock" }; break; }
      const valorActual = parseInt(sAj[campoAj]) || 0;
      const valorNuevo  = Math.max(0, valorActual + parseInt(deltaAj));
      await sb.update("stock", codAj, { [campoAj]: valorNuevo });
      result = { ok: true, anterior: valorActual, nuevo: valorNuevo };
      break;
    }

    // Auditoría de solo lectura — NO escribe nada, solo compara. Detecta
    // cuándo el contador agregado stock_consignacion (que se incrementa/
    // decrementa manualmente en más de 20 lugares del código) se desvió
    // de la fuente real de verdad: la suma de lo que cada consignación
    // ACTIVA dice que el vendedor tiene en mano (cantidad - vendido).
    // Ese drift fue exactamente la causa del caso Jaime/PUP035.
    case "AUDITORIA_STOCK": {
      if (!esAdmin) return forbidden();
      result = await auditarStock(sb);
      break;
    }

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

    case "CREAR_PRODUCTO": {
      if (!esAdmin) return forbidden();
      const prodId = d.codigo || `PROD_${Date.now()}`;
      // El código se calcula en el navegador mirando el stock que tiene
      // cargado localmente — si dos personas agregan casi al mismo tiempo
      // o el stock local quedó desactualizado, podrían calcular el mismo
      // código sin saberlo. Sin esta verificación, sb.set() lo hubiera
      // sobrescrito en silencio (mismo id = mismo registro).
      const existente = await sb.get("stock", prodId);
      if (existente) {
        result = { ok: false, error: `El código ${prodId} ya existe (${existente.nombre || "otro producto"}) — alguien más lo generó justo antes. Vuelve a intentar para que se recalcule.` };
        break;
      }
      await sb.set("stock", prodId, {
        codigo:             prodId,
        codigoBase:         prodId,
        nombre:             d.nombre || "",
        precio:             Math.round((parseFloat(d.precio) || 0) * 100) / 100,
        foto:               d.img || d.foto || "",
        descripcion:        d.caracteristicas || "",
        descripcionTienda:  d.caracteristicas || "",
        categoria:          String(d.categoria || "").toUpperCase(),
        material:           d.material || "",
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

    case "GET_STOCK": {
      const stock = await sb.getAll("stock");
      // Admin (Hub con _pass): inventario completo. Público (links de producto /p, catálogos /c de
      // afiliados, vista previa de links): solo los campos de producto que esas páginas usan —
      // nunca consignación, ventas, reservas internas ni otros campos que el Hub guarde.
      // Se incluye config (ej. fraseConfianza del catálogo) porque
      // catalogo.html (los links /c/:id) ya llama GET_STOCK para el
      // chequeo de disponibilidad en vivo — reutilizar esa llamada evita
      // un fetch extra solo para leer la frase editable de envíos/pago.
      const cfgStock = await sb.get("config", "settings");
      const activos = stock.filter(p => p.estado !== "inactivo");
      result = { ok: true, stock: esAdmin ? activos : activos.map(stockPublico), config: sanearConfigPublico(cfgStock) };
      break;
    }

    case "STOCK_ASIGNAR_TIENDA": {
      if (!esAdmin) return forbidden();
      result = await stockAsignarTiendaEnBloque(sb, d);
      break;
    }

    case "STOCK_ASIGNAR_VENDEDOR": {
      if (!esAdmin) return forbidden();
      if (!d.vendedor) return json({ ok: false, error: "vendedor requerido" });
      // Crea el registro de consignación del vendedor (para que la pieza sea rastreable en su inventario, ventas y
      // corte) y mueve el stock bodega -> consignación. En bloque: ~4 peticiones sin importar cuántos códigos.
      result = await stockAsignarVendedorEnBloque(sb, d);
      break;
    }

    // Hace visibles (o oculta) productos en la tienda online SIN mover inventario: solo cambia enCatalogo. La tienda vende
    // con stock_tienda + stock_bodega (reserva atómica: primero tienda, luego bodega), así que el inventario sigue siendo
    // uno solo para todos los canales. En bloque: 2 peticiones sin importar cuántos códigos.
    case "STOCK_PUBLICAR_VISIBLE": {
      if (!esAdmin) return forbidden();
      const cods = Array.from(new Set((Array.isArray(d.codigos) ? d.codigos : []).map(String).filter(Boolean))).slice(0, 1000);
      if (!cods.length) { result = { ok: false, error: "codigos requeridos" }; break; }
      const visible = d.visible !== false;
      const docs = new Map((await sb.getMany("stock", cods)).map(x => [String(x.id), x]));
      const cambiar = [], yaEstaban = [], noExisten = [], inactivos = [];
      for (const c of cods) {
        const x = docs.get(c);
        if (!x) { noExisten.push(c); continue; }
        if (x.estado === "inactivo") { inactivos.push(c); continue; }
        const actual = x.enCatalogo === true || x.enCatalogo === "true" || x.enCatalogo === "TRUE";
        if (actual === visible) { yaEstaban.push(c); continue; }
        // Fecha de publicación / retiro: la usa «✨ Sugerir qué publicar» del admin para no repetir lo de hace poco.
        cambiar.push({ ...x, enCatalogo: visible, [visible ? "publicadoEn" : "despublicadoEn"]: new Date().toISOString() });
      }
      if (cambiar.length) await sb.setMany("stock", cambiar);
      result = { ok: true, visible, cambiados: cambiar.map(x => x.id), yaEstaban, noExisten, inactivos };
      break;
    }

    // Ocasiones (15 años, compromiso, caballero…): etiquetas INTERNAS para armar catálogos de cliente en el admin.
    // Se aplican al DISEÑO completo — todas las tallas activas que comparten código base — para que ninguna talla
    // quede fuera del filtro. Solo escribe el campo `ocasiones` (merge parcial con update_doc): nunca toca
    // cantidades, así que no puede pisar una venta que entre al mismo tiempo.
    // d.codigos + d.ocasiones (reemplaza la lista) o d.agregar / d.quitar (ids de ocasión).
    case "STOCK_OCASIONES": {
      if (!esAdmin) return forbidden();
      const idsOcasion = a => Array.from(new Set((Array.isArray(a) ? a : []).map(x => String(x).trim().toLowerCase()).filter(x => /^[a-z0-9-]{1,40}$/.test(x))));
      const cods = Array.from(new Set((Array.isArray(d.codigos) ? d.codigos : []).map(String).filter(Boolean))).slice(0, 60);
      if (!cods.length) { result = { ok: false, error: "codigos requeridos" }; break; }
      const reemplazo = Array.isArray(d.ocasiones) ? idsOcasion(d.ocasiones).slice(0, 20) : null;
      const agregar = idsOcasion(d.agregar), quitar = new Set(idsOcasion(d.quitar));
      if (!reemplazo && !agregar.length && !quitar.size) { result = { ok: false, error: "ocasiones requeridas" }; break; }
      const pedidos = new Set(cods.map(c => c.toUpperCase()));
      const bases = new Set(cods.map(c => _baseTrio(c).toUpperCase()));
      const filas = (await sb.getAll("stock")).filter(x => {
        if (x.estado === "inactivo") return false;
        const c = String(x.codigo || x.id).toUpperCase();
        return pedidos.has(c) || bases.has(_baseTrio(c).toUpperCase()) || bases.has(String(x.codigoBase || "").toUpperCase());
      });
      const cambios = [];
      for (const x of filas) {
        const antes = Array.isArray(x.ocasiones) ? x.ocasiones.map(String) : [];
        const despues = reemplazo ? reemplazo : Array.from(new Set([...antes, ...agregar])).filter(o => !quitar.has(o));
        if (antes.length === despues.length && antes.every(o => despues.includes(o))) continue;
        cambios.push({ codigo: String(x.codigo || x.id), ocasiones: despues });
      }
      // Límite del plan: 50 subrequests por petición. Pocas filas (lo normal: un diseño desde el Hub, o 5 desde
      // el modo rápido del admin) → patch por fila, que nunca toca cantidades. Muchas → en bloque (1 petición
      // por 100 filas) releyendo las filas justo antes de escribir, igual que STOCK_PUBLICAR_VISIBLE.
      if (cambios.length <= 30) {
        await Promise.all(cambios.map(c => sb.update("stock", c.codigo, { ocasiones: c.ocasiones })));
      } else {
        const nuevasOc = new Map(cambios.map(c => [c.codigo, c.ocasiones]));
        const frescos = await sb.getMany("stock", [...nuevasOc.keys()]);
        await sb.setMany("stock", frescos.map(x => ({ ...x, ocasiones: nuevasOc.get(String(x.id)) })));
      }
      result = { ok: true, actualizados: cambios };
      break;
    }

    // Costo de una pieza: se guarda en TODAS las tallas del diseño (mismo código base), como las ocasiones.
    // costo null/"" = borrarlo. Solo escribe el campo `costo` (patch), nunca toca cantidades.
    case "STOCK_COSTO": {
      if (!esAdmin) return forbidden();
      const codC = String(d.codigo || "").trim();
      if (!codC) { result = { ok: false, error: "codigo requerido" }; break; }
      const costoN = d.costo === null || d.costo === "" ? null : Math.round(parseFloat(d.costo) * 100) / 100;
      if (costoN !== null && !(costoN >= 0 && costoN < 100000)) { result = { ok: false, error: "Costo inválido" }; break; }
      const baseC = _baseDeCodigo(codC).toUpperCase();
      const filasC = (await sb.getAll("stock")).filter(x => {
        const c = String(x.codigo || x.id).toUpperCase();
        return c === codC.toUpperCase() || _baseDeCodigo(c).toUpperCase() === baseC || String(x.codigoBase || "").toUpperCase() === baseC;
      });
      if (!filasC.length) { result = { ok: false, error: "Producto no encontrado" }; break; }
      const codsC = filasC.map(x => String(x.codigo || x.id));
      // 50 subrequests por petición: pocas tallas → patch por fila; muchas → en bloque releyendo justo antes.
      if (codsC.length <= 30) await Promise.all(codsC.map(c => sb.update("stock", c, { costo: costoN })));
      else { const frescos = await sb.getMany("stock", codsC); await sb.setMany("stock", frescos.map(x => ({ ...x, costo: costoN }))); }
      result = { ok: true, costo: costoN, codigos: codsC };
      break;
    }

    // Revisa en qué categoría está cada producto y detecta los mal clasificados (solo lectura).
    case "AUDITORIA_CATEGORIAS": {
      if (!esAdmin) return forbidden();
      const catsA = await categoriasTiendaActual(sb);
      const a = analizarCategorias(await sb.getAll("stock"), catsA);
      result = { ok: true, categorias: catsA, ...a };
      break;
    }

    // Cambia la categoría de los productos indicados (bloque: 2 peticiones). Solo categorías válidas; el resto no se toca.
    case "CORREGIR_CATEGORIAS": {
      if (!esAdmin) return forbidden();
      const catsC = await categoriasTiendaActual(sb);
      const cambios = (Array.isArray(d.cambios) ? d.cambios : []).filter(c => c && c.codigo && catsC[String(c.categoria || "").toUpperCase()]).slice(0, 1000);
      if (!cambios.length) { result = { ok: false, error: "cambios requeridos" }; break; }
      const docsC = new Map((await sb.getMany("stock", cambios.map(c => String(c.codigo)))).map(x => [String(x.id), x]));
      const nuevos = [], noExisten = [];
      for (const c of cambios) { const x = docsC.get(String(c.codigo)); if (!x) { noExisten.push(c.codigo); continue; } nuevos.push({ ...x, categoria: String(c.categoria).toUpperCase() }); }
      if (nuevos.length) await sb.setMany("stock", nuevos);
      result = { ok: true, corregidos: nuevos.map(x => x.id), noExisten };
      break;
    }

    // Qué código nuevo recibiría cada diseño (no escribe nada). El código siempre lo sugiere el sistema.
    case "SUGERIR_CODIGOS": {
      if (!esAdmin) return forbidden();
      const its = (Array.isArray(d.items) ? d.items : []).filter(x => x && x.codigo).slice(0, 40);
      if (!its.length) { result = { ok: false, error: "items requeridos" }; break; }
      result = { ok: true, sugerencias: await sugerirCodigos(sb, its) };
      break;
    }

    // Cambia el código de los diseños indicados (todas sus tallas), todo o nada por diseño. Máx. 4 diseños por llamada.
    case "CAMBIAR_CODIGOS": {
      if (!esAdmin) return forbidden();
      const its = (Array.isArray(d.items) ? d.items : []).filter(x => x && x.codigo);
      if (!its.length) { result = { ok: false, error: "items requeridos" }; break; }
      if (new Set(its.map(x => _baseDeCodigo(x.codigo).toUpperCase())).size > 4) { result = { ok: false, error: "máximo 4 diseños por llamada" }; break; }
      result = { ok: true, resultados: await cambiarCodigos(sb, its) };
      break;
    }

    // Quita el aviso «cambiar etiqueta» una vez que la etiqueta física ya se reemplazó.
    case "MARCAR_ETIQUETA_CAMBIADA": {
      if (!esAdmin) return forbidden();
      const cs = Array.from(new Set((Array.isArray(d.codigos) ? d.codigos : []).map(String).filter(Boolean))).slice(0, 200);
      const dc = (await sb.getMany("stock", cs)).filter(x => x.etiquetaPendiente);
      if (dc.length) await sb.setMany("stock", dc.map(x => ({ ...x, etiquetaPendiente: false, etiquetaCambiadaEn: new Date().toISOString() })));
      result = { ok: true, actualizados: dc.map(x => x.id) };
      break;
    }

    case "STOCK_DEVOLVER_BODEGA": {
      if (!esAdmin) return forbidden();
      result = await stockDevolverBodegaEnBloque(sb, d);
      break;
    }

    case "EDITAR_PRODUCTO": {
      if (!esAdmin) return forbidden();
      const upd = {};
      if (d.nombre          !== undefined) upd.nombre            = d.nombre;
      // OJO: Stock (y el catálogo) muestran nombre_base primero, no
      // nombre — si solo se actualiza nombre, el cambio queda invisible
      // en todas partes aunque sí se haya guardado en la base de datos.
      if (d.nombre_base     !== undefined) upd.nombre_base       = d.nombre_base;
      if (d.precio          !== undefined) upd.precio            = Math.round((parseFloat(d.precio) || 0) * 100) / 100;
      if (d.img             !== undefined) upd.foto              = d.img;
      // Si la foto CAMBIA, la versión mejorada guardada es de la foto anterior y las pantallas la muestran antes que
      // `foto`: el cambio parecía no aplicarse. Se borra salvo que la petición traiga una mejorada nueva.
      if (d.img !== undefined && d.fotoMejorada === undefined) {
        const actual = await sb.get("stock", d.codigo);
        if (actual && actual.fotoMejorada && String(actual.foto || "") !== String(d.img || "")) { upd.fotoMejorada = ""; upd.fotoMejoraNivel = ""; }
      }
      // Foto "Mejorada" (nitidez vía ImageKit, desde el botón ✨ del
      // admin) — nunca toca `foto` (la original), se guarda aparte.
      if (d.fotoMejorada    !== undefined) upd.fotoMejorada      = d.fotoMejorada;
      if (d.fotoMejoraNivel !== undefined) upd.fotoMejoraNivel   = d.fotoMejoraNivel;
      if (d.descripcion     !== undefined) upd.descripcionTienda = d.descripcion;
      if (d.destacado       !== undefined) upd.destacado         = d.destacado;
      if (d.enCatalogo      !== undefined) upd.enCatalogo        = Boolean(d.enCatalogo);
      if (d.stock_bodega    !== undefined) upd.stock_bodega      = Math.max(0, parseInt(d.stock_bodega) || 0);
      if (d.caracteristicas !== undefined) upd.caracteristicas   = d.caracteristicas;
      if (d.material        !== undefined) upd.material          = d.material;
      if (d.caracterEspecial !== undefined) upd.caracterEspecial = d.caracterEspecial;
      if (d.set_config      !== undefined) upd.set_config        = d.set_config || null;
      if (d.precio_caballero !== undefined) upd.precio_caballero = d.precio_caballero || null;
      if (d.reservado       !== undefined) upd.reservado         = Boolean(d.reservado);
      // Nexus → «No ofrecer por WhatsApp»: Lyra no ofrece esta pieza (WA_STOCK / waOfrecible)
      if (d.noOfrecerWhatsApp !== undefined) upd.noOfrecerWhatsApp = Boolean(d.noOfrecerWhatsApp);
      if (d.codigoBase      !== undefined) upd.codigoBase        = d.codigoBase;
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

    // Deshace ELIMINAR_PRODUCTO -- vuelve a poner el registro inactivo
    // como activo, sin recrearlo ni tocar sus cantidades (quedan tal
    // como estaban al momento de eliminarlo). d.estado opcional para
    // elegir dónde reaparece (bodega/tienda/consignacion); por defecto
    // bodega, que es donde vive la gran mayoria de los productos.
    case "REACTIVAR_PRODUCTO": {
      if (!esAdmin) return forbidden();
      await sb.update("stock", d.codigo, { estado: d.estado || "bodega" });
      result = { ok: true };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
