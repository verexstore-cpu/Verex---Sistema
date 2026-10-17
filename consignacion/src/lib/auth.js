// Sesiones de admin, contraseña, TOTP (2FA) y PIN de vendedores
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { RL_API, RL_LOGIN, RL_PIN, rlBlocked, rlFail, rlReset, safeEq } from "./seguridad.js";

// ── AUTENTICACIÓN ────────────────────────────────────────────────
// ── SESIONES DE ADMIN ───────────────────────────────────────────────
// Pase "vxs1.<vence>.<versión>.<firma>": lo firma el Worker al entrar con
// contraseña + código (TOTP_VERIFICAR) y vence a las 8 h. No se guarda en
// ninguna parte: la firma HMAC basta para comprobarlo. "Cerrar todas las
// sesiones" (o cambiar la contraseña) sube config.sesionVersion y todos los
// pases anteriores dejan de valer.
export const SESION_MS = 8 * 60 * 60 * 1000;

// Hasta esta fecha se sigue aceptando la contraseña directa en las acciones de
// admin (pestañas/dispositivos con la sesión vieja). Después, solo pases.
export const SESION_TRANSICION_HASTA = Date.parse("2026-10-25T06:00:00Z");

export function enTransicionSesiones() { return Date.now() < SESION_TRANSICION_HASTA; }

export function esPaseSesion(v) { return typeof v === "string" && v.startsWith("vxs1."); }

export async function firmaSesion(env, datos) {
  const base = String(env.SESSION_SECRET || env.SUPABASE_SERVICE_KEY || "");
  if (!base) return "";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("verex-sesion|" + base), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(datos)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// expMax: tope de vencimiento (SSO: la sesión nueva vence con la que la generó).
export async function crearSesion(env, sb, expMax) {
  const cfg = (await sb.get("config", "settings")) || {};
  const ver = parseInt(cfg.sesionVersion) || 0;
  _verSesionCache = { v: ver, t: Date.now() };
  let exp = Date.now() + SESION_MS;
  if (expMax && expMax < exp) exp = expMax;
  if (exp <= Date.now()) return {};
  const firma = await firmaSesion(env, `vxs1.${exp}.${ver}`);
  if (!firma) return {};
  return { sesion: `vxs1.${exp}.${ver}.${firma}`, exp };
}

// Devuelve el vencimiento (ms) si el pase es válido y sigue vigente; 0 si no.
export async function vencimientoSesion(pase, env, sb) {
  if (!esPaseSesion(pase) || pase.length > 200) return 0;
  const partes = pase.split(".");
  if (partes.length !== 4) return 0;
  const exp = parseInt(partes[1]), ver = parseInt(partes[2]);
  const ahora = Date.now();
  if (!(exp > ahora) || exp > ahora + SESION_MS + 60000 || !(ver >= 0)) return 0;
  const firma = await firmaSesion(env, `vxs1.${exp}.${ver}`);
  if (!firma || !safeEq(partes[3], firma)) return 0;
  const verActual = await versionSesiones(sb).catch(() => -1);
  if (verActual !== ver) return 0;
  return exp;
}

// Versión vigente de las sesiones, con caché de 20 s por instancia del Worker para no
// leer config en cada acción del panel. Cerrar sesiones / cambiar la contraseña la
// actualiza al instante en esta instancia; en las demás tarda como máximo 20 s.
export let _verSesionCache = { v: 0, t: 0 };

export async function versionSesiones(sb) {
  if (Date.now() - _verSesionCache.t < 20000) return _verSesionCache.v;
  const cfg = await sb.get("config", "settings");
  _verSesionCache = { v: parseInt(cfg && cfg.sesionVersion) || 0, t: Date.now() };
  return _verSesionCache.v;
}

export async function sesionValida(pase, env, sb) { return (await vencimientoSesion(pase, env, sb)) > 0; }

export async function hashStr(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Verifica la contraseña: primero contra SECRET_PASS (env var),
// si no coincide intenta con el hash guardado en Supabase
// (permite cambiar contraseña sin editar el env var de Cloudflare).
//
// Protegida contra fuerza bruta: se comprueba el bloqueo ANTES de comparar
// (si no, el intento correcto tras el bloqueo seguiría entrando) y cada fallo
// se cuenta por IP. scope "login" (endpoints de acceso, 5 fallos) o "api"
// (acciones con _pass, 15 fallos: tolera pestañas viejas con clave antigua).
export async function verificarPassword(pass, env, sb, ip, scope) {
  if (!pass) return false;
  const key = (scope === "login" ? "login:" : "api:") + (ip || "unknown");
  if (await rlBlocked(sb, key)) return false;
  const ok = await compararPassword(pass, env, sb);
  if (ok) await rlReset(sb, key);
  else await rlFail(sb, key, scope === "login" ? RL_LOGIN : RL_API);
  return ok;
}

export async function compararPassword(pass, env, sb) {
  const secret = env.SECRET_PASS || "";
  // Aceptar texto plano (SECRET_PASS del env) o su hash SHA-256
  let ok = secret ? safeEq(pass, secret) : false;
  if (secret && safeEq(pass, await hashStr(secret))) ok = true;
  if (ok) return true;
  // También verificar contra passHash guardado en Supabase
  try {
    const cfg = await sb.get("config", "settings");
    if (cfg && cfg.passHash) {
      // Aceptar el hash directamente (frontend ya lo hasheó)
      let okDb = safeEq(pass, cfg.passHash);
      // O hashear lo que llegó (compatibilidad con texto plano)
      if (safeEq(await hashStr(pass), cfg.passHash)) okDb = true;
      if (okDb) return true;
    }
  } catch(_) {}
  return false;
}

// Clave legacy de vendedores (d.key): mismo trato — comparación segura y límite de intentos.
// Valores que viajan dentro del código PÚBLICO de los catálogos (verexstore.com y us.verexstore.com):
// cualquiera puede verlos, así que nunca dan acceso de admin aunque SECRET_KEY tuviera ese valor, y
// tampoco cuentan como intento fallido (si no, los pedidos de clientes desde una misma IP podían
// bloquear el acceso del admin). Si SECRET_KEY en Cloudflare es uno de estos, cambiarlo.
export const CLAVES_LEGACY_PUBLICAS = new Set(["VEREX_2026_PRO"]);

export async function claveLegacyValida(key, env, sb, ip) {
  if (!key || !env.SECRET_KEY) return false;
  if (CLAVES_LEGACY_PUBLICAS.has(String(key))) return false;
  const rk = "api:" + (ip || "unknown");
  if (await rlBlocked(sb, rk)) return false;
  if (safeEq(key, env.SECRET_KEY)) return true;
  await rlFail(sb, rk, RL_API);
  return false;
}

// PIN de vendedor: true si es incorrecto O si está bloqueado por demasiados fallos.
// El token ya se validó antes, así que el contador es por vendedor (no por IP).
export async function pinIncorrecto(sb, vend, pin, vendedorId) {
  if (!vend || !vend.pin) return false;
  const key = "pin:" + String(vendedorId || vend.id || "?");
  if (await rlBlocked(sb, key)) return true;
  if (safeEq(vend.pin, pin || "")) { await rlReset(sb, key); return false; }
  await rlFail(sb, key, RL_PIN);
  return true;
}

// ── TOTP (RFC 6238) — 2FA del Admin sin depender de ningún token de
// terceros que se pueda filtrar y usar para mandar espam (reemplaza el
// OTP que se enviaba por Telegram). El código de 6 dígitos lo genera la
// app autenticadora (Google Authenticator, Authy, etc.) localmente en el
// celular a partir de un secreto compartido guardado en Supabase
// (config.settings.totpSecret) — nada que enviar, nada que interceptar. ──
export function base32Encode(bytes) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) {
    out += alfabeto[parseInt(bits.substr(i, 5).padEnd(5, "0"), 2)];
  }
  return out;
}

export function base32Decode(str) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of String(str).toUpperCase().replace(/=+$/, "")) {
    const idx = alfabeto.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return new Uint8Array(bytes);
}

export async function totpGenerar(secretBase32, offsetPasos = 0) {
  const key = base32Decode(secretBase32);
  const contador = Math.floor(Date.now() / 1000 / 30) + offsetPasos;
  const contadorBytes = new Uint8Array(8);
  let c = contador;
  for (let i = 7; i >= 0; i--) { contadorBytes[i] = c & 0xff; c = Math.floor(c / 256); }
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, contadorBytes));
  const offset = firma[firma.length - 1] & 0x0f;
  const bin = ((firma[offset] & 0x7f) << 24) | ((firma[offset+1] & 0xff) << 16) | ((firma[offset+2] & 0xff) << 8) | (firma[offset+3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

// Acepta el paso de tiempo actual y uno de margen (±30s) por si el reloj
// del celular está un poco desincronizado.
export async function totpVerificar(secretBase32, codigo) {
  const codigoNorm = String(codigo || "").trim();
  if (!codigoNorm) return false;
  for (const offset of [0, -1, 1]) {
    if (await totpGenerar(secretBase32, offset) === codigoNorm) return true;
  }
  return false;
}

// Para que CERRAR_SESIONES / ACTUALIZAR_PASS_HASH (en otro módulo) actualicen la caché al instante.
export function fijarVersionSesiones(v) { _verSesionCache = { v, t: Date.now() }; }
