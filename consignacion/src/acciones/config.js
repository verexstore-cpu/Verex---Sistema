// Configuración, contraseña y sesiones, garantía/cambios, correo y respaldo
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { fijarVersionSesiones } from "../lib/auth.js";
import { probarCorreo } from "../lib/avisos.js";
import { validarCategorias } from "../lib/codigos.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { sanearConfigPublico } from "../lib/publico.js";

export async function accionesConfig({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    case "GET_CONFIG": {
      const cfg = await sb.get("config", "settings");
      result = { ok: true, config: sanearConfigPublico(cfg) };
      break;
    }

    case "GUARDAR_CONFIG": {
      if (!esAdmin) return forbidden();
      if (d.config && d.config.categorias !== undefined) {                 // lista de categorías del Editor de la página
        const errCat = validarCategorias(d.config.categorias);
        if (errCat) { result = { ok: false, error: errCat }; break; }
      }
      await sb.update("config", "settings", d.config || {});
      result = { ok: true };
      break;
    }

    case "GET_ESTADO_CORREO": {
      if (!esAdmin) return forbidden();
      result = { ok: true, estado: (await sb.get("config", "correo_estado")) || null };
      break;
    }

    case "PROBAR_CORREO": {
      if (!esAdmin) return forbidden();
      const para = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.para || "") ? d.para : "verex.pedidos@verexstore.com";
      result = { ...(await probarCorreo(env, para)), para };
      break;
    }

    case "GET_GARANTIA": {
      // Pública — la lee garantia.html sin necesidad de login
      const g = await sb.get("config", "garantia");
      result = { ok: true, garantia: g || null };
      break;
    }

    case "GUARDAR_GARANTIA": {
      if (!esAdmin) return forbidden();
      const { intro, dias, cubre, no_cubre, promo, solicitud, evaluacion, destacado } = d;
      await sb.set("config", "garantia", {
        intro: intro || "", dias: parseInt(dias) || 30,
        cubre: cubre || "", no_cubre: no_cubre || "",
        promo: promo || "", solicitud: solicitud || "",
        evaluacion: evaluacion || "", destacado: destacado || "",
        actualizado: new Date().toISOString()
      });
      result = { ok: true };
      break;
    }

    case "GET_CAMBIOS": {
      // Pública — la lee cambios.html sin necesidad de login
      const cm = await sb.get("config", "cambios");
      result = { ok: true, cambios: cm || null };
      break;
    }

    case "GUARDAR_CAMBIOS": {
      if (!esAdmin) return forbidden();
      const { texto, costoReenvio } = d;
      await sb.set("config", "cambios", {
        texto: texto || "",
        costoReenvio: parseFloat(costoReenvio) || 0,
        actualizado: new Date().toISOString()
      });
      result = { ok: true };
      break;
    }

    case "ACTUALIZAR_PASS_HASH": {
      if (!esAdmin) return forbidden();
      // Cambiar la contraseña cierra todas las sesiones abiertas (incluida esta).
      const cfgPH = (await sb.get("config", "settings")) || {};
      const verPH = (parseInt(cfgPH.sesionVersion) || 0) + 1;
      await sb.update("config", "settings", { passHash: d.nuevoHash, sesionVersion: verPH });
      fijarVersionSesiones(verPH);
      result = { ok: true, sesionesCerradas: true };
      break;
    }

    // Cierra TODAS las sesiones abiertas (todos los dispositivos): sube la
    // versión y los pases anteriores dejan de valer al instante.
    case "CERRAR_SESIONES": {
      if (!esAdmin) return forbidden();
      const cfgCS = (await sb.get("config", "settings")) || {};
      const verCS = (parseInt(cfgCS.sesionVersion) || 0) + 1;
      await sb.update("config", "settings", { sesionVersion: verCS });
      fijarVersionSesiones(verCS);
      result = { ok: true };
      break;
    }

    // Lo usan las Functions de admin-tienda (_auth.js) para validar a quien
    // llama: mismo criterio que esAdmin (pase vigente, o contraseña en transición).
    case "VERIFICAR_SESION": {
      result = { ok: esAdmin };
      break;
    }

    case "ACTUALIZAR_CONFIG": {
      if (!esAdmin) return forbidden();
      await sb.update("config", "settings", d.config || {});
      result = { ok: true };
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

    default:
      return NO_MANEJADA;
  }
  return result;
}
