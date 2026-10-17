// VEREX Chats: lógica del chat en vivo y avisos push
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { hashStr } from "./auth.js";
import { waTelId } from "./lyra-whatsapp.js";
import { safeEq } from "./seguridad.js";

// ── CHAT EN VIVO CON TRADUCCIÓN ───────────────────────────────────
// Ver los case LIVE_* del switch. Aquí solo se guarda y se lee: la traducción y la sesión
// del asesor las maneja verex-catalogo-us. El cliente se identifica con el hash de su
// token (tokenHash), que se compara con el guardado al crear el chat.
export const LIVE_ID_RE = /^[a-z0-9]{12,40}$/;

export const LIVE_ESTADOS = ["esperando", "activo", "cerrado"];

export const liveTxt = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);

export const liveChatPublico = c => {
  if (!c) return null;
  const { tokenHash, ...resto } = c;
  return resto;
};

export async function liveChatAccion(sb, d) {
  if (d.accion.startsWith("LIVE_PUSH_")) return livePushAccion(sb, d);
  const chatId = String(d.chatId || "");
  if (d.accion !== "LIVE_CHATS_LISTAR" && !LIVE_ID_RE.test(chatId)) return { ok: false, error: "chat_invalido" };
  const ahora = new Date().toISOString();
  // Si llega tokenHash, la acción es del CLIENTE: solo vale para SU chat (lo valida aquí mismo,
  // en la misma lectura, para que cada sondeo cueste una sola llamada).
  const delCliente = d.tokenHash !== undefined;
  const tokenOk = chat => !!chat && !!chat.tokenHash && safeEq(String(d.tokenHash || ""), chat.tokenHash);

  switch (d.accion) {
    case "LIVE_CHAT_CREAR": {
      const c = d.chat || {};
      const resumen = {};
      for (const k of ["busca", "vio", "pregunta"]) if (c.resumen && c.resumen[k]) resumen[k] = liveTxt(c.resumen[k], 250);
      const chat = {
        chatId, estado: "esperando",
        idioma: c.idioma === "es" ? "es" : "en",
        tokenHash: liveTxt(c.tokenHash, 128),
        nombre: liveTxt(c.nombre, 60), email: liveTxt(c.email, 120),
        resumen, pagina: liveTxt(c.pagina, 200),
        creado: ahora, actualizado: ahora, ultimo: null, agente: "", mensajes: 0,
      };
      if (!chat.tokenHash) return { ok: false, error: "token_requerido" };
      const creado = await sb.insertIfAbsent("config", `livechat-${chatId}`, chat);
      return creado ? { ok: true, chat: liveChatPublico(chat) } : { ok: false, error: "chat_existe" };
    }

    case "LIVE_CHAT_GET": {
      const chat = await sb.get("config", `livechat-${chatId}`);
      if (!chat) return { ok: false, error: "chat_no_existe" };
      if (delCliente && !tokenOk(chat)) return { ok: false, error: "token_invalido" };
      return { ok: true, chat: liveChatPublico(chat) };
    }

    case "LIVE_CHAT_ESTADO": {
      const estado = LIVE_ESTADOS.includes(d.estado) ? d.estado : null;
      if (!estado) return { ok: false, error: "estado_invalido" };
      const chat = await sb.get("config", `livechat-${chatId}`);
      if (!chat) return { ok: false, error: "chat_no_existe" };
      if (delCliente && (!tokenOk(chat) || estado !== "cerrado")) return { ok: false, error: "token_invalido" };
      const patch = { estado, actualizado: ahora };
      if (estado === "cerrado") { patch.cerrado = ahora; patch.cerradoPor = delCliente ? "cliente" : "asesor"; }
      await sb.update("config", `livechat-${chatId}`, patch);
      // WhatsApp: cerrar el chat = devolvérselo a Lyra (se quita la pausa de su sesión)
      if (estado === "cerrado" && chat.canal === "whatsapp" && chat.tel) {
        const idSes = await waTelId(chat.tel);
        if (await sb.get("config", idSes)) await sb.update("config", idSes, { humanoHasta: 0, necesitaHumano: null });
      }
      return { ok: true, chat: liveChatPublico({ ...chat, ...patch }) };
    }

    case "LIVE_MSG_AGREGAR": {
      const m = d.msg || {};
      const msgId = String(m.msgId || "");
      if (!/^[a-z0-9]{8,40}$/.test(msgId)) return { ok: false, error: "mensaje_invalido" };
      const autor = ["cliente", "asesor", "sistema"].includes(m.autor) ? m.autor : null;
      const original = liveTxt(m.original, 2000);
      if (!autor || !original) return { ok: false, error: "mensaje_invalido" };
      const chat = await sb.get("config", `livechat-${chatId}`);
      if (!chat) return { ok: false, error: "chat_no_existe" };
      if (delCliente && (!tokenOk(chat) || autor !== "cliente")) return { ok: false, error: "token_invalido" };
      if (chat.estado === "cerrado") return { ok: false, error: "chat_cerrado" };
      const msg = {
        chatId, msgId, autor, original, ts: ahora,
        idioma: m.idioma === "es" ? "es" : m.idioma === "en" ? "en" : "",
        traduccion: liveTxt(m.traduccion, 2000),
        dir: ["en>es", "es>en"].includes(m.dir) ? m.dir : "",
        errorTraduccion: liveTxt(m.errorTraduccion, 80),
        agente: autor === "asesor" ? liveTxt(m.agente, 40) : "",
      };
      // El id del mensaje lo genera quien lo escribe: si un reintento llega dos veces, no se duplica.
      const nuevo = await sb.insertIfAbsent("config", `livemsg-${chatId}-${msgId}`, msg);
      if (!nuevo) {
        const existente = await sb.get("config", `livemsg-${chatId}-${msgId}`);
        return { ok: true, duplicado: true, msg: existente };
      }
      const patch = {
        actualizado: ahora, mensajes: (chat.mensajes || 0) + 1,
        ultimo: { autor, texto: (autor === "cliente" && msg.traduccion ? msg.traduccion : original).slice(0, 140), ts: ahora },
      };
      // El idioma del chat sigue al del cliente (si cambia de inglés a español, el asesor deja de traducir).
      if (autor === "cliente" && msg.idioma && msg.idioma !== chat.idioma) patch.idioma = msg.idioma;
      if (autor === "asesor") {
        // «lyra» = chat de WhatsApp que atendía Lyra: al responder una persona, pasa a activo
        if (chat.estado === "esperando" || chat.estado === "lyra") { patch.estado = "activo"; if (!chat.primeraRespuesta) patch.primeraRespuesta = ahora; }
        if (msg.agente) patch.agente = msg.agente;
      }
      await sb.update("config", `livechat-${chatId}`, patch);
      return { ok: true, msg };
    }

    case "LIVE_MSGS": {
      const desde = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(d.desde || "")) ? d.desde : "";
      const conChat = d.conChat || delCliente;
      const [msgs, chat] = await Promise.all([
        sb.listPrefix("config", `livemsg-${chatId}-`, { campo: "ts", mayorQue: desde, limite: 300 }),
        conChat ? sb.get("config", `livechat-${chatId}`) : null,
      ]);
      if (conChat && !chat) return { ok: false, error: "chat_no_existe" };
      if (delCliente && !tokenOk(chat)) return { ok: false, error: "token_invalido" };
      msgs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      return { ok: true, msgs, chat: conChat ? liveChatPublico(chat) : undefined };
    }

    case "LIVE_CHATS_LISTAR": {
      const dias = Math.min(Math.max(parseInt(d.dias, 10) || 3, 1), 30);
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      const chats = await sb.listPrefix("config", "livechat-", { campo: "actualizado", mayorQue: desde, limite: 200 });
      chats.sort((a, b) => (a.actualizado < b.actualizado ? 1 : -1));
      return { ok: true, chats: chats.map(liveChatPublico) };
    }
  }
  return { ok: false, error: "accion_invalida" };
}

// Teléfonos/PC de los asesores que reciben avisos push de chats nuevos (config/livepush-<hash del endpoint>).
// Guarda solo la suscripción del navegador (endpoint + claves públicas), nunca datos del cliente.
export async function livePushAccion(sb, d) {
  const endpoint = String(d.endpoint || d.sub?.endpoint || "");
  const idPush = async () => "livepush-" + (await hashStr(endpoint)).slice(0, 40);
  switch (d.accion) {
    case "LIVE_PUSH_GUARDAR": {
      const keys = d.sub?.keys || {};
      if (!/^https:\/\/[^\s]{10,600}$/.test(endpoint) || !/^[A-Za-z0-9_-]{40,140}$/.test(keys.p256dh || "") || !/^[A-Za-z0-9_-]{8,60}$/.test(keys.auth || "")) {
        return { ok: false, error: "suscripcion_invalida" };
      }
      const ahora = new Date().toISOString();
      await sb.set("config", await idPush(), {
        endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth },
        nombre: liveTxt(d.nombre, 40), dispositivo: liveTxt(d.dispositivo, 80), actualizado: ahora,
      });
      return { ok: true };
    }
    case "LIVE_PUSH_BORRAR": {
      if (!endpoint) return { ok: false, error: "suscripcion_invalida" };
      await sb.delete("config", await idPush());
      return { ok: true };
    }
    case "LIVE_PUSH_LISTAR": {
      const subs = await sb.listPrefix("config", "livepush-", { limite: 50 });
      return { ok: true, subs: subs.map(x => ({ endpoint: x.endpoint, keys: x.keys, nombre: x.nombre || "" })) };
    }
  }
  return { ok: false, error: "accion_invalida" };
}
