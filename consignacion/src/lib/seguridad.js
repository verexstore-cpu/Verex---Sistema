// Seguridad: comparación segura, límite de intentos, CORS
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.
import { CORS } from "./http.js";

// ── SEGURIDAD: comparación segura, límite de intentos, CORS ───────
// Comparación en tiempo constante (no revela cuántos caracteres coinciden).
export function safeEq(a, b) {
  const x = new TextEncoder().encode(String(a ?? "")), y = new TextEncoder().encode(String(b ?? ""));
  let r = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) r |= (x[i] || 0) ^ (y[i] || 0);
  return r === 0;
}

// Límite de intentos. Estado en Supabase config/rl_<clave> ({n, start, until, strikes}).
// Cada bloqueo dura el doble que el anterior (hasta 24 h). Si Supabase falla, NO se bloquea
// (mejor abierto que dejar al admin fuera por una caída). Caché local 20 s para no leer
// la base en cada petición.
export const MIN = 60 * 1000;

export const RL_LOGIN     = { max: 5,  windowMs: 15 * MIN, baseLockMs: 15 * MIN };

export const RL_API       = { max: 15, windowMs: 15 * MIN, baseLockMs: 15 * MIN };

export const RL_TOTP_ALL  = { max: 10, windowMs: 15 * MIN, baseLockMs: 15 * MIN };

export const RL_PIN       = { max: 8,  windowMs: 15 * MIN, baseLockMs: 15 * MIN };

export const RL_UPLOAD    = { max: 120, windowMs: 60 * MIN, baseLockMs: 30 * MIN };

   // subidas con la clave pública de upload.html
export const RL_CACHE = new Map();

export const RL_TTL = 20 * 1000;

/** Devuelve el instante (ms) hasta el que está bloqueada la clave, o 0 si no lo está. */
export async function rlBlocked(sb, key) {
  const now = Date.now(), c = RL_CACHE.get(key);
  if (c && c.exp > now) return c.until > now ? c.until : 0;
  let rec = null;
  try { rec = await sb.get("config", "rl_" + key); } catch (_) { /* fail-open */ }
  const until = rec && rec.until > now ? rec.until : 0;
  RL_CACHE.set(key, { until, n: rec ? rec.n || 0 : 0, exp: now + RL_TTL });
  return until;
}

// Cada fallo se guarda como un registro PROPIO (config/rlfx-<clave>-<ms>-<azar>) y luego se cuentan los de la ventana.
// Antes era leer-sumar-guardar un contador: con muchos intentos en paralelo se perdían sumas y el límite se podía
// saltar. Los registros no se pisan entre sí, así que ningún intento se pierde.
export const _rlPref = key => "rlfx-" + String(key).replace(/[_%*\\]/g, "-") + "-";

export async function rlFail(sb, key, cfg) {
  const now = Date.now(), pref = _rlPref(key);
  let filas = null;
  try {
    await sb.insertIfAbsent("config", pref + now + "-" + Math.random().toString(36).slice(2, 10), { k: key, t: now });
    filas = (await sb.listPrefix("config", pref, { limite: 400 })).filter(r => r.k === key && typeof r.t === "number");
  } catch (_) { /* fail-open: si Supabase falla, no se bloquea */ }
  if (!filas) return;
  const recientes = filas.filter(r => now - r.t <= cfg.windowMs);
  const viejas = filas.filter(r => now - r.t > cfg.windowMs).map(r => r.id);
  let until = 0;
  if (recientes.length >= cfg.max) {
    let rec = null;
    try { rec = await sb.get("config", "rl_" + key); } catch (_) {}
    rec = rec ? { until: rec.until || 0, strikes: rec.strikes || 0 } : { until: 0, strikes: 0 };
    if (rec.until && now - rec.until > 24 * 60 * MIN) rec.strikes = 0;      // el historial se olvida tras 24 h limpio
    rec.strikes++;
    until = now + Math.min(cfg.baseLockMs * Math.pow(2, rec.strikes - 1), 24 * 60 * MIN);
    try { await sb.set("config", "rl_" + key, { n: 0, start: now, until, strikes: rec.strikes }); } catch (_) {}
    viejas.push(...recientes.map(r => r.id));   // el bloqueo ya cuenta: se empieza de cero
  }
  if (viejas.length) { try { await sb.deleteMany("config", viejas); } catch (_) {} }
  RL_CACHE.set(key, { until, n: until ? 0 : recientes.length, exp: now + RL_TTL });
}

/** Tras un acceso correcto: borra los fallos pendientes (solo si había alguno). */
export async function rlReset(sb, key) {
  const c = RL_CACHE.get(key), now = Date.now();
  if (c && c.exp > now && !c.n && !c.until) return;
  let rec = null, filas = [];
  try {
    rec = await sb.get("config", "rl_" + key);
    filas = (await sb.listPrefix("config", _rlPref(key), { limite: 400 })).filter(r => r.k === key);
  } catch (_) { return; }
  if (filas.length && !(rec && rec.until > now)) { try { await sb.deleteMany("config", filas.map(r => r.id)); } catch (_) {} }
  RL_CACHE.set(key, { until: rec && rec.until > now ? rec.until : 0, n: 0, exp: now + RL_TTL });
}

export function tooMany(until) {
  const sec = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  return new Response(JSON.stringify({
    ok: false, bloqueado: true, retryAfter: sec,
    error: "Demasiados intentos. Intenta de nuevo en " + Math.ceil(sec / 60) + " min."
  }), { status: 429, headers: { ...CORS, "Retry-After": String(sec) } });
}

// CORS con lista blanca (env.ALLOWED_ORIGINS). Sin la variable: comportamiento anterior (*).
// Tolerante al pegar la lista: separa por coma, punto y coma, espacios o saltos de línea, y compara sin
// distinguir mayúsculas, sin barra final y sin comillas (el navegador envía el origen sin barra: "https://x.com").
// OJO: CORS solo protege a navegadores; no sustituye la autenticación.
export function normalizarOrigen(o) {
  return String(o || "").trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "").toLowerCase();
}

export function aplicarCors(request, env, res) {
  const lista = String(env.ALLOWED_ORIGINS || "").split(/[\s,;]+/).map(normalizarOrigen).filter(Boolean);
  if (!lista.length) return res;
  const origin = request.headers.get("Origin");
  const h = new Headers(res.headers);
  h.append("Vary", "Origin");
  if (origin && lista.includes(normalizarOrigen(origin))) h.set("Access-Control-Allow-Origin", origin);
  else h.delete("Access-Control-Allow-Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
