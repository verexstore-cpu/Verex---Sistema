// VEREX Chats: chat en vivo con traducción y avisos push del asesor
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { totpVerificar, verificarPassword } from "../lib/auth.js";
import { liveChatAccion } from "../lib/chat-en-vivo.js";
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { RL_LOGIN, RL_TOTP_ALL, rlBlocked, rlFail, rlReset, safeEq } from "../lib/seguridad.js";

export async function accionesChatEnVivo({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    // El cliente habla con el asesor dentro de la ventana de Lyra; las Pages Functions de
    // verex-catalogo-us traducen (inglés ↔ español) y guardan aquí cada mensaje con su
    // original y su traducción. Solo las llaman esas Pages Functions, con el secreto
    // interno (INTERNAL_SECRET); la sesión del asesor la validan ellas y la contraseña
    // solo se comprueba en LIVE_AGENTE_LOGIN.
    //   config/livechat-<chatId>           → datos del chat (estado, idioma, resumen de Lyra…)
    //   config/livemsg-<chatId>-<msgId>    → un documento por mensaje (solo se insertan:
    //                                        nunca hay dos escrituras peleando por el mismo doc)
    // Login de la app VEREX Chats: la MISMA seguridad que el Admin (contraseña + código TOTP de
    // 6 dígitos, con los mismos límites de intentos). La IP real del asesor la manda la Pages
    // Function (de confianza: trae el secreto interno), para que los límites sean por persona.
    case "LIVE_AGENTE_LOGIN": {
      if (!env.INTERNAL_SECRET || !safeEq(request.headers.get("X-Verex-Internal") || "", env.INTERNAL_SECRET)) return forbidden();
      const ipAg = String(d.ipCliente || ip).slice(0, 64);
      const bloqAg = await rlBlocked(sb, "login:" + ipAg);
      if (bloqAg) { result = { ok: false, error: "bloqueado", retryAfter: bloqAg }; break; }
      if (!(await verificarPassword(d.pass, env, sb, ipAg, "login"))) { result = { ok: false, error: "credenciales" }; break; }
      const cfgAg = await sb.get("config", "settings");
      if (!cfgAg || !cfgAg.totpSecret) { result = { ok: false, error: "totp_no_configurado" }; break; }
      const bTotpAg = (await rlBlocked(sb, "totp:" + ipAg)) || (await rlBlocked(sb, "totp:all"));
      if (bTotpAg) { result = { ok: false, error: "bloqueado", retryAfter: bTotpAg }; break; }
      if (!(await totpVerificar(cfgAg.totpSecret, d.codigo))) {
        await rlFail(sb, "totp:" + ipAg, RL_LOGIN);
        await rlFail(sb, "totp:all", RL_TOTP_ALL);
        result = { ok: false, error: "codigo" };
        break;
      }
      await rlReset(sb, "totp:" + ipAg);
      result = { ok: true };
      break;
    }

    case "LIVE_CHAT_CREAR":
    case "LIVE_CHAT_GET":
    case "LIVE_CHAT_ESTADO":
    case "LIVE_MSG_AGREGAR":
    case "LIVE_MSGS":
    case "LIVE_CHATS_LISTAR":
    case "LIVE_PUSH_GUARDAR":
    case "LIVE_PUSH_BORRAR":
    case "LIVE_PUSH_LISTAR": {
      if (!env.INTERNAL_SECRET || !safeEq(request.headers.get("X-Verex-Internal") || "", env.INTERNAL_SECRET)) return forbidden();
      result = await liveChatAccion(sb, d);
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
