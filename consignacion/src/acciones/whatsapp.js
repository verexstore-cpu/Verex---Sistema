// Lyra en WhatsApp: stock, sesiones, mensajes y configuración
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
// Cada acción devuelve el resultado (se responde como JSON) o una Response; NO_MANEJADA si no es de este módulo.
import { NO_MANEJADA, forbidden } from "../lib/http.js";
import { sanearConfigLyra, waLyraAccion } from "../lib/lyra-whatsapp.js";
import { safeEq } from "../lib/seguridad.js";

export async function accionesWhatsApp({ d, sb, env, ip, esAdmin, request }) {
  let result;
  switch (d.accion) {

    // ── Lyra en WhatsApp (Pages Functions de verex-catalogo-us, con el secreto interno) ──
    //   WA_STOCK       → todo el stock que se puede OFRECER (no solo lo publicado en la tienda) + config + garantía/cambios
    //   WA_SESION_GET  → memoria de la conversación de un número  (config/wasesion-<hash del teléfono>)
    //   WA_SESION_SET  → guarda esa memoria
    //   WA_MSG_VISTO   → marca un mensaje como procesado (idempotencia: WhatsApp reintenta los webhooks)
    //   WA_ANUNCIO_VISTO → anota el anuncio de Meta del que llegó un cliente (Admin → Lyra lo lista para asignarle piezas)
    //   WA_CHAT_REGISTRAR → guarda la conversación en VEREX Chats (livechat-wa…): mensajes del cliente, de Lyra y del equipo
    case "WA_STOCK":
    case "WA_SESION_GET":
    case "WA_SESION_SET":
    case "WA_MSG_VISTO":
    case "WA_ANUNCIO_VISTO":
    case "WA_CHAT_REGISTRAR": {
      if (!env.INTERNAL_SECRET || !safeEq(request.headers.get("X-Verex-Internal") || "", env.INTERNAL_SECRET)) return forbidden();
      result = await waLyraAccion(sb, d);
      break;
    }

    // ── Admin → 🤖 Lyra WhatsApp: encendido/modo, «Promo de Lyra» y anuncio → piezas (config/lyra) ──
    // Va en su propio documento (no en config/settings) para que no salga en GET_CATALOGO/GET_STOCK
    // y para que un Admin abierto en otro dispositivo no lo pise al guardar su configuración.
    case "LYRA_CONFIG_GET": {
      if (!esAdmin) return forbidden();
      const [lyra, vistos] = await Promise.all([sb.get("config", "lyra"), sb.get("config", "lyra-anuncios-vistos")]);
      const lista = Object.entries((vistos && vistos.anuncios) || {}).map(([adId, v]) => ({ adId, ...v }))
        .sort((a, b) => String(b.ultimo || "").localeCompare(String(a.ultimo || ""))).slice(0, 30);
      result = { ok: true, lyra: lyra || {}, anunciosVistos: lista };
      break;
    }

    case "LYRA_CONFIG_SET": {
      if (!esAdmin) return forbidden();
      const limpio = sanearConfigLyra(d.lyra);
      await sb.set("config", "lyra", { ...limpio, actualizado: new Date().toISOString() });
      result = { ok: true, lyra: limpio };
      break;
    }

    default:
      return NO_MANEJADA;
  }
  return result;
}
