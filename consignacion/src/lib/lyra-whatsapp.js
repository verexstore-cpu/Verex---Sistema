// Lyra en WhatsApp: configuración y acciones
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { hashStr } from "./auth.js";
import { liveTxt } from "./chat-en-vivo.js";
import { sanearConfigPublico, stockPublico } from "./publico.js";

// ── LYRA EN WHATSAPP ─────────────────────────────────────────────
// Qué se puede ofrecer por WhatsApp: TODO el inventario activo con unidades en mano (bodega + tienda), con foto
// y precio — no solo lo publicado en la tienda. Nunca: consignación (está con vendedores), apartado/reservado,
// productos de prueba, eliminados o marcados «No ofrecer por WhatsApp» en Nexus.
export function waOfrecible(p) {
  if (!p || p.estado === "inactivo" || p.esPrueba || p.noOfrecerWhatsApp === true || p.reservado) return false;
  if (!(parseFloat(p.precio) > 0)) return false;
  const foto = String(p.fotoMejorada || p.foto || p.img || "");
  if (!/^https:\/\//.test(foto)) return false;
  return (parseInt(p.stock_tienda) || 0) + (parseInt(p.stock_bodega) || 0) > 0;
}

// Configuración de Lyra que guarda el Admin. Todo con tipo y tope: lo que no se reconoce se descarta.
export const LYRA_TIPOS_PROMO = ["2x50", "3x2", "montoFijo", "escalonado"];

export function sanearConfigLyra(c) {
  c = c && typeof c === "object" ? c : {};
  const txt = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
  const num = (v, min, max) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : 0; };
  const fecha = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
  const out = { activa: c.activa !== false, modo: ["pruebas", "anuncios", "todos"].includes(c.modo) ? c.modo : "" };
  const p = c.promo && typeof c.promo === "object" ? c.promo : null;
  if (p) {
    const promo = { activa: p.activa === true, nombre: txt(p.nombre, 60), desde: fecha(p.desde), hasta: fecha(p.hasta) };
    const bTxt = txt(p.banner?.txt, 80);
    if (bTxt) {
      promo.banner = { txt: bTxt, sub: txt(p.banner?.sub, 120), color: /^#[0-9a-f]{3,8}$/i.test(String(p.banner?.color || "")) ? p.banner.color : "#C9A84C" };
      const pct = Math.round(num(p.descPct, 0, 50));
      if (pct > 0) promo.descPct = pct;
    }
    const pc = p.promoCarrito;
    if (pc && LYRA_TIPOS_PROMO.includes(pc.tipo)) {
      if (pc.tipo === "montoFijo") {
        const montoFijo = num(pc.montoFijo, 0, 500), minimoCompra = num(pc.minimoCompra, 0, 10000);
        if (montoFijo > 0) promo.promoCarrito = { tipo: "montoFijo", montoFijo, ...(minimoCompra > 0 && { minimoCompra }) };
      } else if (pc.tipo === "escalonado") {
        const escalones = (Array.isArray(pc.escalones) ? pc.escalones : []).slice(0, 6)
          .map(e => ({ minCant: Math.round(num(e?.minCant, 0, 50)), pct: Math.round(num(e?.pct, 0, 50)) })).filter(e => e.minCant >= 2 && e.pct > 0);
        if (escalones.length) promo.promoCarrito = { tipo: "escalonado", escalones };
      } else promo.promoCarrito = { tipo: pc.tipo };
    }
    const envio = num(p.envioGratisDesde, 0, 10000);
    if (envio > 0) promo.envioGratisDesde = envio;
    const rMonto = num(p.regaloSorpresa?.monto, 0, 10000), rTexto = txt(p.regaloSorpresa?.texto, 80);
    if (rMonto > 0 && rTexto) promo.regaloSorpresa = { monto: rMonto, texto: rTexto };
    out.promo = promo;
  }
  out.anuncios = (Array.isArray(c.anuncios) ? c.anuncios : []).slice(0, 30).map(a => ({
    adId: String(a?.adId || "").replace(/\D/g, "").slice(0, 30),
    nombre: txt(a?.nombre, 60),
    codigos: [...new Set((Array.isArray(a?.codigos) ? a.codigos : String(a?.codigos || "").split(/[\s,;]+/))
      .map(x => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)).filter(x => x.length >= 2))].slice(0, 12),
    mensaje: txt(a?.mensaje, 300),
  })).filter(a => a.adId && a.codigos.length);
  return out;
}

export const waTelId = async (tel) => "wasesion-" + (await hashStr("wa|" + String(tel || "").replace(/\D/g, ""))).slice(0, 40);

export async function waLyraAccion(sb, d) {
  switch (d.accion) {
    case "WA_STOCK": {
      const [stock, cfg, garantia, cambios] = await Promise.all([
        sb.getAll("stock"), sb.get("config", "settings"), sb.get("config", "garantia"), sb.get("config", "cambios"),
      ]);
      const { contenidoUS, ...cfgPub } = sanearConfigPublico(cfg || {});   // los textos de la tienda USA no aplican aquí
      const lyra = await sb.get("config", "lyra");
      return { ok: true, productos: stock.filter(waOfrecible).map(stockPublico), config: cfgPub, garantia: garantia || null, cambios: cambios || null, lyra: lyra ? sanearConfigLyra(lyra) : {} };
    }
    case "WA_SESION_GET": {
      if (!d.tel) return { ok: false, error: "tel requerido" };
      return { ok: true, sesion: (await sb.get("config", await waTelId(d.tel))) || null };
    }
    case "WA_SESION_SET": {
      if (!d.tel || !d.sesion || typeof d.sesion !== "object") return { ok: false, error: "tel y sesion requeridos" };
      const txt = JSON.stringify(d.sesion);
      if (txt.length > 60000) return { ok: false, error: "sesion demasiado grande" };
      await sb.set("config", await waTelId(d.tel), { ...d.sesion, actualizado: new Date().toISOString() });
      return { ok: true };
    }
    case "WA_ANUNCIO_VISTO": {
      const adId = String(d.adId || "").replace(/\D/g, "").slice(0, 30);
      if (!adId) return { ok: false, error: "adId requerido" };
      const doc = (await sb.get("config", "lyra-anuncios-vistos")) || {};
      const anuncios = { ...(doc.anuncios || {}) };
      const prev = anuncios[adId] || {};
      anuncios[adId] = { titulo: String(d.titulo || prev.titulo || "").slice(0, 120), n: (parseInt(prev.n) || 0) + 1, primero: prev.primero || new Date().toISOString(), ultimo: new Date().toISOString() };
      // se guardan los 50 más recientes
      const top = Object.entries(anuncios).sort((a, b) => String(b[1].ultimo).localeCompare(String(a[1].ultimo))).slice(0, 50);
      await sb.set("config", "lyra-anuncios-vistos", { anuncios: Object.fromEntries(top) });
      return { ok: true };
    }
    case "WA_CHAT_REGISTRAR": {
      // Un chat por número: livechat-wa<hash>. Estados: «lyra» (la atiende Lyra), «esperando» (pidió a una
      // persona), «activo» (respondió el equipo), «cerrado» (el equipo se lo devolvió a Lyra).
      const tel = String(d.tel || "").replace(/\D/g, "").slice(0, 20);
      if (tel.length < 8) return { ok: false, error: "tel requerido" };
      const chatId = "wa" + (await hashStr("wa|" + tel)).slice(0, 30);
      const id = `livechat-${chatId}`;
      const ahora = Date.now();
      const iso = (i = 0) => new Date(ahora + i).toISOString();
      const pedido = ["lyra", "esperando"].includes(d.estado) ? d.estado : "";
      const msgs = (Array.isArray(d.msgs) ? d.msgs : []).slice(0, 10).map(m => ({
        msgId: String(m?.msgId || ""), autor: ["cliente", "lyra", "asesor"].includes(m?.autor) ? m.autor : "",
        original: liveTxt(m?.original, 2000), agente: liveTxt(m?.agente, 40),
      })).filter(m => /^[a-z0-9]{8,40}$/.test(m.msgId) && m.autor && m.original);
      let chat = await sb.get("config", id);
      if (!chat) {
        chat = { chatId, canal: "whatsapp", tel, estado: pedido || "lyra", idioma: "es", tokenHash: "",
          nombre: liveTxt(d.nombre, 60), email: "", resumen: {}, pagina: "", creado: iso(), actualizado: iso(), ultimo: null, agente: "", mensajes: 0 };
        await sb.insertIfAbsent("config", id, chat);
        chat = (await sb.get("config", id)) || chat;
      }
      const patch = { actualizado: iso(msgs.length) };
      if (d.nombre && !chat.nombre) patch.nombre = liveTxt(d.nombre, 60);
      const delCliente = msgs.some(m => m.autor === "cliente");
      if (chat.estado === "cerrado" && (delCliente || pedido)) {
        // el cliente volvió a escribir: se reabre (como lo atienda Lyra o esperando al equipo)
        Object.assign(patch, { estado: pedido || "lyra", cerrado: "", cerradoPor: "", agente: "" });
      } else if (pedido === "esperando" && chat.estado === "lyra") patch.estado = "esperando";
      // el equipo escribió desde la app de WhatsApp (coexistencia): ya lo atiende una persona
      if (msgs.some(m => m.autor === "asesor") && ["lyra", "esperando", "cerrado"].includes(patch.estado || chat.estado)) {
        Object.assign(patch, { estado: "activo", cerrado: "", cerradoPor: "" });
        if (!chat.primeraRespuesta) patch.primeraRespuesta = iso();
      }
      if (d.motivo) patch.resumen = { ...(chat.resumen || {}), pregunta: liveTxt(d.motivo, 250) };
      if (d.anuncio) patch.resumen = { ...(patch.resumen || chat.resumen || {}), busca: liveTxt(d.anuncio, 250) };
      let n = chat.mensajes || 0, ultimo = chat.ultimo;
      for (const [i, m] of msgs.entries()) {
        const msg = { chatId, msgId: m.msgId, autor: m.autor, original: m.original, ts: iso(i), idioma: "es", traduccion: "", dir: "", errorTraduccion: "", agente: m.autor === "asesor" ? m.agente : "" };
        if (await sb.insertIfAbsent("config", `livemsg-${chatId}-${m.msgId}`, msg)) {
          n++; ultimo = { autor: m.autor, texto: m.original.slice(0, 140), ts: msg.ts };
          if (m.autor === "cliente") patch.ultimoCliente = msg.ts;
        }
      }
      patch.mensajes = n; patch.ultimo = ultimo;
      await sb.update("config", id, patch);
      return { ok: true, chatId, estado: patch.estado || chat.estado };
    }
    case "WA_MSG_VISTO": {
      const id = String(d.msgId || "").replace(/[^A-Za-z0-9._=:-]/g, "").slice(0, 120);
      if (!id) return { ok: false, error: "msgId requerido" };
      const nuevo = await sb.insertIfAbsent("config", "wamsg-" + id, { ts: new Date().toISOString() });
      return { ok: true, nuevo: !!nuevo };
    }
  }
  return { ok: false, error: "accion desconocida" };
}
