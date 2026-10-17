// ═══════════════════════════════════════════════════════════════════
//  VEREX API — Cloudflare Worker con Supabase — v2026.06
//  (CF_API_TOKEN/CF_ACCOUNT_ID renovados en GitHub Actions - 2026-08-17)
//
//  SECRETS en Cloudflare (Settings → Variables → Secrets):
//    SUPABASE_URL         → URL del proyecto (ej: https://xxx.supabase.co)
//    SUPABASE_SERVICE_KEY → service_role key (Settings → API en Supabase)
//    SECRET_PASS          → contraseña del admin
//    SECRET_KEY           → clave legacy de vendedores
//    INTERNAL_SECRET      → (recomendado) secreto compartido con las Functions de Pages de Admin
//                           (variable INTERNAL_SECRET del proyecto admin-tienda, mismo valor). Permite
//                           que el límite de intentos use la IP real del cliente y no la de Cloudflare.
//    ALLOWED_ORIGINS      → (opcional) orígenes CORS permitidos, separados por coma, p. ej.
//                           https://verexstore.com,https://admin.ejemplo.pages.dev,null
//                           ("null" = archivos locales/Hub). Sin definir → CORS abierto (*), como antes.
//    IMAGEKIT_PRIVATE_KEY → clave privada de ImageKit
//    RESEND_KEY           → API key de Resend (correos)
//    WOMPI_CLIENT_ID       → App ID del negocio en Wompi (checkout USA)
//    WOMPI_CLIENT_SECRET   → API Secret del negocio en Wompi
//    WOMPI_WEBHOOK_SECRET  → token random propio — NO viene de Wompi, se
//                            genera acá y se usa como sufijo de la URL del
//                            webhook (Wompi no firma sus webhooks)
//    PAYPAL_CLIENT_ID      → Client ID de la app de PayPal (checkout oficial USA)
//    PAYPAL_SECRET         → Secret de la misma app
//    PAYPAL_WEBHOOK_ID     → ID del webhook creado en esa app (para verificar la firma de PayPal)
//    PAYPAL_ENV            → "live" para cobros reales; cualquier otro valor (o vacío) = Sandbox de pruebas
//    PAYPAL_RETURN_BASE    → (opcional) a dónde vuelve el cliente tras pagar; por defecto https://us.verexstore.com/
// ═══════════════════════════════════════════════════════════════════
//
// ── ESTRUCTURA ─────────────────────────────────────────────────────
// Este archivo es la entrada del Worker (wrangler.toml → main): rutas GET, webhooks, login de
// admin y el reparto de cada acción (POST { accion }) al módulo que la atiende:
//   src/acciones/stock.js — Inventario: stock, productos, códigos y categorías
//   src/acciones/vendedores.js — Vendedores: alta, tokens, firma de contrato, entregas y correcciones
//   src/acciones/consignacion.js — Consignación: entregas, ventas y devoluciones del vendedor, cortes
//   src/acciones/ventas-directas.js — Ventas directas: registro, abonos, cambios y devoluciones
//   src/acciones/reportes.js — Reportes: historial de ventas, cierres mensuales, estadísticas y visitas
//   src/acciones/tienda.js — Tienda online (verexstore.com): catálogo público, pedidos, clientes y cupones
//   src/acciones/pedidos-catalogo.js — Pedidos de catálogos y afiliados (leads): reserva, confirmación, entrega y cancelación
//   src/acciones/usa.js — Tienda USA (us.verexstore.com): pedidos, pagos PayPal/Wompi, reembolsos, rentabilidad y VEREX AI
//   src/acciones/config.js — Configuración, contraseña y sesiones, garantía/cambios, correo y respaldo
//   src/acciones/imagenes.js — Fotos e imágenes: ImageKit, quitar fondo, fotos pendientes
//   src/acciones/ia.js — Inteligencia artificial: análisis de fotos, traducciones e interpretación de pedidos
//   src/acciones/chat-en-vivo.js — VEREX Chats: chat en vivo con traducción y avisos push del asesor
//   src/acciones/whatsapp.js — Lyra en WhatsApp: stock, sesiones, mensajes y configuración
//   src/cron.js — tareas programadas (reservas vencidas, resumen diario, respaldo)
//   src/lib/ — funciones de apoyo compartidas (Supabase, sesiones, pagos, correo…)
// Wrangler une todos los archivos al publicar. Pruebas: node correr-pruebas.mjs

import { accionesStock } from "./src/acciones/stock.js";
import { accionesVendedores } from "./src/acciones/vendedores.js";
import { accionesConsignacion } from "./src/acciones/consignacion.js";
import { accionesVentasDirectas } from "./src/acciones/ventas-directas.js";
import { accionesReportes } from "./src/acciones/reportes.js";
import { accionesTienda } from "./src/acciones/tienda.js";
import { accionesPedidosCatalogo } from "./src/acciones/pedidos-catalogo.js";
import { accionesUSA } from "./src/acciones/usa.js";
import { accionesConfig } from "./src/acciones/config.js";
import { accionesImagenes } from "./src/acciones/imagenes.js";
import { accionesIA } from "./src/acciones/ia.js";
import { accionesChatEnVivo } from "./src/acciones/chat-en-vivo.js";
import { accionesWhatsApp } from "./src/acciones/whatsapp.js";
import { tareasProgramadas } from "./src/cron.js";
import { SESION_MS, base32Encode, claveLegacyValida, crearSesion, enTransicionSesiones, esPaseSesion, sesionValida, totpVerificar, vencimientoSesion, verificarPassword } from "./src/lib/auth.js";
import { fijarSbCorreo } from "./src/lib/avisos.js";
import { CORS, NO_MANEJADA, json } from "./src/lib/http.js";
import { sanearConfigPublico } from "./src/lib/publico.js";
import { RL_LOGIN, RL_TOTP_ALL, aplicarCors, rlBlocked, rlFail, rlReset, safeEq, tooMany } from "./src/lib/seguridad.js";
import { Supabase } from "./src/lib/supabase.js";
import { manejarWebhookPayPal, manejarWebhookWompi } from "./src/lib/usa-pagos.js";

export default {
  async scheduled(event, env, ctx) {
    return tareasProgramadas(event, env, ctx);
  },

  // Envoltorio: aplica la lista blanca de CORS (si hay ALLOWED_ORIGINS) a TODA respuesta.
  async fetch(request, env) {
    const res = await this.handle(request, env);
    return aplicarCors(request, env, res);
  },

  async handle(request, env) {
    if (request.method === "OPTIONS") return new Response("", { headers: CORS });

    const sb = new Supabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    fijarSbCorreo(sb);
    let ip = request.headers.get("CF-Connecting-IP") || "unknown";
    // Las Functions de Pages llaman desde servidores de Cloudflare (IP compartida). Reenvían la IP real
    // del cliente y solo se les cree si presentan el secreto interno; sin él, cualquiera podría falsificarla.
    const ipReenviada = request.headers.get("X-Verex-Client-IP");
    if (ipReenviada && env.INTERNAL_SECRET && safeEq(request.headers.get("X-Verex-Internal") || "", env.INTERNAL_SECRET)) ip = ipReenviada.slice(0, 64);

    // ── GET: rutas ────────────────────────────────────────────────
    if (request.method === "GET") {
      const url = new URL(request.url);

      // Página del celular para tomar foto
      if (url.pathname === "/foto-upload") {
        const session = (url.searchParams.get("s") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);   // va dentro del HTML: nada de comillas ni etiquetas
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>VEREX — Foto</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#111;color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:20px;gap:16px}
.logo{font-size:22px;font-weight:700;color:#C9A84C;letter-spacing:1px}
#preview{width:100%;max-width:340px;aspect-ratio:1;object-fit:cover;border-radius:16px;display:none;border:2px solid #C9A84C}
.btn{width:100%;max-width:340px;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;background:#C9A84C;color:#111}
.btn:disabled{opacity:.5;cursor:not-allowed}
#status{font-size:14px;color:#aaa;text-align:center;min-height:20px}
#tick{font-size:48px;display:none}</style></head>
<body>
<div class="logo">✨ VEREX — Foto</div>
<img id="preview" alt="preview">
<div id="tick">✅</div>
<input type="file" id="inp" accept="image/*" capture="environment" style="display:none" onchange="onFoto(this)">
<button class="btn" onclick="document.getElementById('inp').click()">📷 Tomar foto</button>
<button class="btn" id="btnEnviar" style="display:none;background:#34D399;margin-top:4px" onclick="enviar()">✅ Enviar foto</button>
<div id="status" style="font-size:16px;font-weight:700;color:#C9A84C;">ID: ${session || "sin sesión"}</div>
<script>
let b64="";
function onFoto(inp){
  const file=inp.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=1000; let w=img.width,h=img.height;
      if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
      if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
      const c=document.createElement("canvas");c.width=w;c.height=h;
      c.getContext("2d").drawImage(img,0,0,w,h);
      b64=c.toDataURL("image/jpeg",0.72);
      document.getElementById("preview").src=b64;
      document.getElementById("preview").style.display="block";
      document.getElementById("btnEnviar").style.display="block";
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
async function enviar(){
  const btn=document.getElementById("btnEnviar");
  btn.disabled=true; btn.textContent="⏳ Enviando...";
  document.getElementById("status").textContent="Subiendo foto...";
  try{
    const r=await fetch(location.origin+"/foto-upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accion:"FOTO_CEL_SAVE",session:"${session}",data:b64})});
    const res=await r.json();
    if(res.ok){
    document.getElementById("tick").style.display="block";
    document.getElementById("preview").style.display="none";
    btn.style.display="none";
    document.getElementById("status").textContent="✅ Foto enviada. Toca 📷 para la siguiente.";
    setTimeout(()=>{document.getElementById("tick").style.display="none";},2000);
    b64="";
    const oldInp=document.getElementById("inp");
    const newInp=document.createElement("input");
    newInp.type="file"; newInp.id="inp"; newInp.accept="image/*";
    newInp.setAttribute("capture","environment");
    newInp.style.display="none";
    newInp.onchange=function(){onFoto(this);};
    oldInp.parentNode.replaceChild(newInp,oldInp);
  } else {
    document.getElementById("status").textContent="Error: "+(res.error||"desconocido");
    btn.disabled=false; btn.textContent="✅ Enviar foto";
  }
  }catch(e){document.getElementById("status").textContent="⚠️ Error de red — intenta de nuevo";btn.disabled=false;btn.textContent="✅ Enviar foto";}
  b64=""; document.getElementById("inp").value="";
}
</script></body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" } });
      }

      // Polling: verificar si hay foto pendiente — devuelve y borra la entrada
      if (url.pathname === "/foto-check") {
        const session = url.searchParams.get("s") || "";
        if (!session) return json({ ok: false, pending: false });
        try {
          const rec = await sb.get("config", `foto_temp_${session}`);
          if (rec && rec.url) {
            await sb.delete("config", `foto_temp_${session}`);
            return json({ ok: true, pending: true, url: rec.url, ts: rec.ts || Date.now() });
          }
          return json({ ok: true, pending: false });
        } catch(e) {
          return json({ ok: false, pending: false, error: e.message });
        }
      }

      // Catálogo público (ruta por defecto)
      try {
        const [prods, cups, cfgDoc] = await Promise.all([
          sb.getAll("stock"),
          sb.getAll("cupones"),
          sb.get("config", "settings"),
        ]);
        return json({
          // Igual que GET_CATALOGO: sin costo de las piezas, ocasiones internas ni quién usó cada cupón.
          productos: prods.filter(p => (p.enCatalogo === true || p.enCatalogo === "true" || p.enCatalogo === "TRUE") && p.estado !== "inactivo").map(({ ocasiones, costo, ...p }) => p),
          cupones:   [],
          config:    sanearConfigPublico(cfgDoc)
        });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // Webhook de Wompi (pago con tarjeta del catálogo USA) — ruta aparte
    // porque el body que manda Wompi no trae "accion". Wompi no documenta
    // firma/HMAC para validar el webhook, así que la URL misma (con el
    // secreto al final) es la autenticación: solo Wompi la conoce porque
    // se la pasamos nosotros al crear cada enlace de pago.
    {
      const urlPost = new URL(request.url);
      if (request.method === "POST" && env.WOMPI_WEBHOOK_SECRET && urlPost.pathname === `/webhook-wompi/${env.WOMPI_WEBHOOK_SECRET}`) {
        return manejarWebhookWompi(request, env, sb);
      }
      // PayPal firma sus webhooks: la autenticación es la verificación de esa firma (ver manejarWebhookPayPal).
      if (request.method === "POST" && urlPost.pathname === "/webhook-paypal") {
        return manejarWebhookPayPal(request, env, sb);
      }
    }

    try {
      const d = await request.json();

      // ── Foto desde celular: guarda base64 directamente en Supabase ──
      if (d.accion === "FOTO_CEL_SAVE") {
        const { session, data } = d;
        if (!session || !data) return json({ ok: false, error: "Faltan datos" });
        try {
          const ts = Date.now();
          await sb.set("config", `foto_temp_${session}`, { url: data, ts });
          return json({ ok: true, ts });
        } catch(e) {
          return json({ ok: false, error: e.message });
        }
      }

      // ── Verificación de contraseña (endpoint público de login) ───
      // Incluye si ya hay un TOTP configurado, para que el frontend sepa
      // si mostrar "ingresa tu código" o la pantalla de configuración
      // inicial (QR + secreto).
      if (d.accion === "VERIFICAR_PASS") {
        // Un pase de sesión no es contraseña: solo se responde si sigue vigente
        // (sin contar intentos fallidos — un pase vencido viene de una pestaña vieja).
        if (esPaseSesion(d._pass)) return json({ ok: await sesionValida(d._pass, env, sb), sesion: true });
        const bloq = await rlBlocked(sb, "login:" + ip);
        if (bloq) return tooMany(bloq);
        const ok = await verificarPassword(d._pass, env, sb, ip, "login");
        if (!ok && d._pass && await rlBlocked(sb, "login:" + ip)) return tooMany(await rlBlocked(sb, "login:" + ip));
        let totpConfigurado = false;
        if (ok) {
          const cfg = await sb.get("config", "settings");
          totpConfigurado = Boolean(cfg && cfg.totpSecret);
        }
        return json({ ok, totpConfigurado });
      }

      // ── 2FA: iniciar (o reiniciar) la configuración de TOTP ─────
      // Genera un secreto nuevo y lo guarda de inmediato — la confirmación
      // real ocurre cuando el código que devuelva la app pase por
      // TOTP_VERIFICAR. Gatillado solo por contraseña, igual que antes se
      // gatillaba el envío del OTP por Telegram: si el celular con la app
      // se pierde, volver a correr esto (con la contraseña) es el mismo
      // nivel de recuperación que ya existía.
      if (d.accion === "TOTP_INICIAR_SETUP") {
        const ok = await verificarPassword(d._pass, env, sb, ip, "login");
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        // Si ya hay un código configurado, solo la contraseña no basta para
        // reemplazarlo (si no, quien robe la contraseña pone SU celular y entra
        // sin el tuyo): hay que tener además una sesión abierta. Celular perdido
        // sin sesión abierta: borrar "totpSecret" de config/settings en Supabase.
        const cfgSetup = await sb.get("config", "settings");
        if (cfgSetup && cfgSetup.totpSecret && !(await sesionValida(d.sesion, env, sb))) {
          return json({ ok: false, error: "ya_configurado" }, 403);
        }
        const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
        await sb.update("config", "settings", { totpSecret: secret });
        const otpauthUrl = `otpauth://totp/${encodeURIComponent("VEREX Admin")}?secret=${secret}&issuer=${encodeURIComponent("VEREX")}&algorithm=SHA1&digits=6&period=30`;
        return json({ ok: true, secret, otpauthUrl });
      }

      // ── 2FA: verificar código TOTP (login normal, y también confirma
      // que la configuración recién hecha quedó bien escaneada) ──────
      if (d.accion === "TOTP_VERIFICAR") {
        const ok = await verificarPassword(d._pass, env, sb, ip, "login");
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        // Límite propio del código de 6 dígitos: por IP y global (una botnet no lo evita)
        const bTotp = (await rlBlocked(sb, "totp:" + ip)) || (await rlBlocked(sb, "totp:all"));
        if (bTotp) return tooMany(bTotp);
        const cfg = await sb.get("config", "settings");
        if (!cfg || !cfg.totpSecret) return json({ ok: false, error: "TOTP no configurado" });
        const valido = await totpVerificar(cfg.totpSecret, d.codigo);
        if (!valido) {
          await rlFail(sb, "totp:" + ip, RL_LOGIN);
          await rlFail(sb, "totp:all", RL_TOTP_ALL);
          return json({ ok: false, error: "Código incorrecto" });
        }
        await rlReset(sb, "totp:" + ip);
        // Contraseña + código correctos → pase de sesión de 8 h. Los paneles lo
        // mandan en _pass en lugar de la contraseña (ver sesionValida).
        return json({ ok: true, ...(await crearSesion(env, sb)) });
      }

      // ── SSO: el Hub ya autenticado genera un token corto de un solo uso
      // para saltar directo a Admin sin volver a pedir contraseña ni el
      // código TOTP — el login normal de Admin (password + TOTP) sigue
      // intacto si se entra directo a su URL sin pasar por el Hub. ──
      if (d.accion === "SSO_CREAR_TOKEN") {
        const expSesionSso = await vencimientoSesion(d._pass, env, sb);
        const ok = expSesionSso > 0 || (enTransicionSesiones() && !esPaseSesion(d._pass) && await verificarPassword(d._pass, env, sb, ip, "login"));
        if (!ok) return json({ ok: false, error: "No autorizado" }, 403);
        const token = crypto.randomUUID();
        const cfgSso = (await sb.get("config", "settings")) || {};
        cfgSso.ssoTokens = cfgSso.ssoTokens || {};
        const ahoraSso = Date.now();
        // Limpia tokens viejos para que el documento no crezca sin control
        for (const t of Object.keys(cfgSso.ssoTokens)) {
          if (ahoraSso - cfgSso.ssoTokens[t].creado > 5 * 60 * 1000) delete cfgSso.ssoTokens[t];
        }
        // exp: la sesión que se abre al otro lado vence cuando vence la del Hub, no se alarga.
        cfgSso.ssoTokens[token] = { creado: ahoraSso, exp: expSesionSso || (ahoraSso + SESION_MS) };
        await sb.set("config", "settings", cfgSso);
        return json({ ok: true, token });
      }

      // ── SSO: Admin canjea el token — un solo uso, expira a los 90s ──
      if (d.accion === "SSO_CANJEAR_TOKEN") {
        const cfgSso = await sb.get("config", "settings");
        // El token tiene que ser un UUID que exista como clave PROPIA de ssoTokens: con "constructor" o "__proto__"
        // se leía una propiedad heredada de Object (truthy, sin `creado`) y se entregaba el hash del admin a cualquiera.
        const tokSso = typeof d.token === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.token) ? d.token : "";
        const tokensSso = cfgSso && cfgSso.ssoTokens && typeof cfgSso.ssoTokens === "object" ? cfgSso.ssoTokens : {};
        const entry = tokSso && Object.prototype.hasOwnProperty.call(tokensSso, tokSso) ? tokensSso[tokSso] : null;
        if (!entry || typeof entry.creado !== "number" || !((Date.now() - entry.creado) <= 90 * 1000)) {
          return json({ ok: false, error: "Token inválido o expirado" });
        }
        delete cfgSso.ssoTokens[d.token];
        await sb.set("config", "settings", cfgSso);
        // Antes devolvía el hash de la contraseña (una llave permanente). Ahora un
        // pase de sesión; va también en "hash" para las páginas que lo guardan ahí.
        const sesSso = await crearSesion(env, sb, entry.exp);
        if (!sesSso.sesion) return json({ ok: false, error: "Sesión vencida" });
        return json({ ok: true, hash: sesSso.sesion, ...sesSso });
      }

      // esAdmin: pase de sesión vigente (login con contraseña + código). Durante la
      // transición (ver SESION_TRANSICION_HASTA) se sigue aceptando también la
      // contraseña directa (SECRET_PASS o el hash de Supabase), para no tumbar
      // pestañas y dispositivos que todavía la tienen guardada.
      const esAdmin = (await sesionValida(d._pass, env, sb)) ||
                      (enTransicionSesiones() && !esPaseSesion(d._pass) && await verificarPassword(d._pass, env, sb, ip, "api")) ||
                      (await claveLegacyValida(d.key, env, sb, ip));

      // Cada módulo de src/acciones/ atiende sus acciones; el primero que la reconoce responde.
      const c = { d, sb, env, ip, esAdmin, request };
      for (const acciones of MODULOS_ACCIONES) {
        const r = await acciones(c);
        if (r === NO_MANEJADA) continue;
        return r instanceof Response ? r : json(r);
      }
      return json({ ok: false, error: `Acción no reconocida: ${d.accion}` });

    } catch(e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }
};

const MODULOS_ACCIONES = [
  accionesStock,
  accionesVendedores,
  accionesConsignacion,
  accionesVentasDirectas,
  accionesReportes,
  accionesTienda,
  accionesPedidosCatalogo,
  accionesUSA,
  accionesConfig,
  accionesImagenes,
  accionesIA,
  accionesChatEnVivo,
  accionesWhatsApp,
];
