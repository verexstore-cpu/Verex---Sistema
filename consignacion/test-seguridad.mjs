// Pruebas de seguridad del Worker (límite de intentos, PIN, TOTP, CORS, fail-open).
// Ejecutar:  node consignacion/test-seguridad.mjs      (sin dependencias; simula Supabase)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), 'verex-worker-under-test.mjs');
fs.copyFileSync(process.env.WORKER_FILE || path.join(here, 'worker-firebase.js'), tmp);
const worker = (await import(pathToFileURL(tmp).href + '?t=' + Date.now())).default;

// ── Supabase simulado (mismo contrato REST que usa la clase Supabase del Worker)
const db = new Map(); let failRl = false; let sbCalls = 0;
const key = (t, id) => t + '/' + id;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); if (!u.hostname.endsWith('sb.test')) return realFetch(url, opts);
  sbCalls++;
  const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/), rpc = u.pathname === '/rest/v1/rpc/update_doc';
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (rpc) { const k = key(body.p_table, body.p_id); db.set(k, { ...(db.get(k) || {}), ...body.p_patch }); return ok({}); }
  if (!m) return ok([]);
  const table = m[1], idq = u.searchParams.get('id');
  if (failRl && ((idq && idq.includes('rl_')) || (body && String(body.id).startsWith('rl_')))) return new Response('boom', { status: 500 });
  if ((opts.method || 'GET') === 'GET') {
    if (idq) { const id = idq.replace(/^eq\./, ''); const d = db.get(key(table, id)); return ok(d ? [{ id, data: d }] : []); }
    return ok([]);
  }
  if (opts.method === 'POST') { db.set(key(table, body.id), body.data); return ok({}); }
  if (opts.method === 'DELETE') { db.delete(key(table, idq.replace(/^eq\./, ''))); return ok({}); }
  return ok({});
};

// ── Reloj controlable
let offset = 0; const realNow = Date.now.bind(Date); Date.now = () => realNow() + offset;
const advance = (min) => { offset += min * 60000; };

const PASS = 'clave-super-secreta';
const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const env = { SUPABASE_URL: 'https://x.sb.test', SUPABASE_SERVICE_KEY: 'k', SECRET_PASS: PASS, SECRET_KEY: 'legacy-key' };
let n = 0; const newIp = () => '203.0.113.' + (++n);
const call = async (d, ip, extraEnv, headers) => {
  const r = await worker.fetch(new Request('https://api.test/', { method: 'POST', headers: { 'CF-Connecting-IP': ip, ...(headers || {}) }, body: JSON.stringify(d) }), { ...env, ...(extraEnv || {}) });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
};
const login = (p, ip) => call({ accion: 'VERIFICAR_PASS', _pass: p }, ip);

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };
console.log('Seguridad del Worker — pruebas\n');

// 1. Login normal
{ const ip = newIp();
  ok((await login(PASS, ip)).body.ok === true, 'login con la contraseña correcta (texto plano)');
  ok((await login(await sha(PASS), ip)).body.ok === true, 'login con el hash SHA-256 (como lo envía el panel)');
  ok((await login('mala', ip)).body.ok === false, 'contraseña incorrecta rechazada'); }

// 2. Fuerza bruta: tras 5 fallos, ni la contraseña CORRECTA entra
{ const ip = newIp(); let last;
  for (let i = 0; i < 5; i++) last = await login('intento' + i, ip);
  ok(last.status === 429 || last.body.ok === false, '5 fallos seguidos');
  const good = await login(PASS, ip);
  ok(good.status === 429 && good.body.bloqueado === true && good.body.ok === false, 'IP bloqueada: la contraseña correcta también se rechaza (429)');
  ok(Number(good.headers.get('Retry-After')) > 800 && Number(good.headers.get('Retry-After')) <= 900, 'cabecera Retry-After ≈ 15 min (' + good.headers.get('Retry-After') + ' s)');
  ok(/Demasiados intentos/.test(good.body.error), 'mensaje claro para el usuario');
  ok((await login(PASS, newIp())).body.ok === true, 'otra IP no se ve afectada');
  advance(16);
  ok((await login(PASS, ip)).body.ok === true, 'a los 16 min el bloqueo expira y entra'); }

// 3. Escalada: el segundo bloqueo dura el doble
{ const ip = newIp();
  for (let i = 0; i < 5; i++) await login('x' + i, ip);           // 1.er bloqueo (15 min)
  advance(16);
  for (let i = 0; i < 5; i++) await login('y' + i, ip);           // 2.º bloqueo (30 min)
  const r = await login(PASS, ip);
  ok(Number(r.headers.get('Retry-After')) > 1700 && Number(r.headers.get('Retry-After')) <= 1800, 'segundo bloqueo ≈ 30 min (' + r.headers.get('Retry-After') + ' s)'); }

// 4. Un acierto borra los fallos previos
{ const ip = newIp();
  for (let i = 0; i < 4; i++) await login('z' + i, ip);
  await login(PASS, ip); advance(1);
  for (let i = 0; i < 4; i++) await login('w' + i, ip);
  ok((await login(PASS, ip)).body.ok === true, '4 fallos + acierto + 4 fallos → no bloquea (contador reiniciado)'); }

// 5. Ruta de acciones de admin (_pass en cualquier acción): tolera 14, bloquea al 15
{ const ip = newIp();
  for (let i = 0; i < 14; i++) await call({ accion: 'GET_TIENDA', _pass: 'vieja' + i }, ip);
  const good = await call({ accion: 'GET_TIENDA', _pass: PASS }, ip);
  ok(good.status !== 403 && good.status !== 429, 'pestaña con clave vieja (14 fallos): la clave correcta aún entra');
  for (let i = 0; i < 15; i++) await call({ accion: 'GET_TIENDA', _pass: 'nueva' + i }, ip);
  const blocked = await call({ accion: 'GET_TIENDA', _pass: PASS }, ip);
  ok(blocked.status === 403, 'tras 15 fallos en acciones de admin, ni la clave correcta entra'); }

// 6. Clave legacy d.key
{ const ip = newIp();
  ok((await call({ accion: 'GET_TIENDA', key: 'legacy-key' }, ip)).status !== 403, 'clave legacy correcta sigue funcionando');
  for (let i = 0; i < 15; i++) await call({ accion: 'GET_TIENDA', key: 'nope' + i }, ip);
  ok((await call({ accion: 'GET_TIENDA', key: 'legacy-key' }, ip)).status === 403, 'clave legacy también se bloquea tras 15 fallos'); }

// 7. Peticiones públicas sin credencial no cuentan como fallo
{ const ip = newIp();
  for (let i = 0; i < 30; i++) await call({ accion: 'GET_TIENDA' }, ip);
  ok((await login(PASS, ip)).body.ok === true, '30 peticiones sin credencial no bloquean al usuario'); }

// 8. PIN de vendedor (token válido + PIN): 8 fallos → bloqueo por vendedor
{ db.set('vendedores/v1', { nombre: 'Ana', tokenInventario: 'tok-123', pin: '4321' });
  const ip = newIp(); const ver = (pin) => call({ accion: 'VERIFICAR_TOKEN', vendedor: 'v1', token: 'tok-123', pin }, ip);
  ok((await ver('4321')).body.ok === true, 'token + PIN correctos entran');
  for (let i = 0; i < 8; i++) await ver(String(1000 + i));
  const r = await ver('4321');
  ok(r.body.ok === false && r.body.razon === 'pin_requerido', 'tras 8 PIN erróneos, el PIN correcto se rechaza (bloqueo por vendedor)');
  ok((await call({ accion: 'VERIFICAR_TOKEN', vendedor: 'v1', token: 'otro', pin: '4321' }, ip)).body.razon === 'token_invalido', 'token inválido sigue rechazándose');
  advance(16);
  ok((await ver('4321')).body.ok === true, 'a los 16 min el PIN correcto vuelve a entrar'); }

// 9. TOTP: el código de 6 dígitos tiene su propio límite (por IP y global)
{ db.set('config/settings', { totpSecret: 'JBSWY3DPEHPK3PXP' });
  const ip = newIp(); let r;
  for (let i = 0; i < 5; i++) r = await call({ accion: 'TOTP_VERIFICAR', _pass: PASS, codigo: '00000' + i }, ip);
  ok(r.body.ok === false, '5 códigos TOTP erróneos rechazados');
  r = await call({ accion: 'TOTP_VERIFICAR', _pass: PASS, codigo: '111111' }, ip);
  ok(r.status === 429, 'el 6.º intento de TOTP queda bloqueado (429) aunque la contraseña sea correcta');
  // botnet: 10 fallos repartidos en IPs distintas activan el bloqueo global del TOTP
  for (let i = 0; i < 6; i++) await call({ accion: 'TOTP_VERIFICAR', _pass: PASS, codigo: '22222' + i }, newIp());
  r = await call({ accion: 'TOTP_VERIFICAR', _pass: PASS, codigo: '333333' }, newIp());
  ok(r.status === 429, 'bloqueo global de TOTP contra ataques desde muchas IPs (429 en IP nueva)'); }

// 10. CORS
{ const ip = newIp();
  let r = await call({ accion: 'GET_TIENDA' }, ip, {}, { Origin: 'https://evil.com' });
  ok(r.headers.get('Access-Control-Allow-Origin') === '*', 'sin ALLOWED_ORIGINS: CORS abierto como antes');
  const cfg = { ALLOWED_ORIGINS: 'https://verexstore.com, null' };
  r = await call({ accion: 'GET_TIENDA' }, ip, cfg, { Origin: 'https://verexstore.com' });
  ok(r.headers.get('Access-Control-Allow-Origin') === 'https://verexstore.com' && /Origin/.test(r.headers.get('Vary')), 'origen permitido: se devuelve ese origen + Vary');
  r = await call({ accion: 'GET_TIENDA' }, ip, cfg, { Origin: 'https://evil.com' });
  ok(r.headers.get('Access-Control-Allow-Origin') === null, 'origen no permitido: sin cabecera CORS');
  r = await call({ accion: 'GET_TIENDA' }, ip, cfg, { Origin: 'null' });
  ok(r.headers.get('Access-Control-Allow-Origin') === 'null', 'origen "null" (Hub local) permitido si se lista');
  const pre = await worker.fetch(new Request('https://api.test/', { method: 'OPTIONS', headers: { Origin: 'https://evil.com' } }), { ...env, ...cfg });
  ok(pre.headers.get('Access-Control-Allow-Origin') === null, 'preflight de origen no permitido sin CORS'); }

// 10a. CORS tolerante al formato de la lista
{ const ip = newIp(); const o = 'https://us.verexstore.com';
  const con = async (valor, origin) => (await call({ accion: 'GET_TIENDA' }, ip, { ALLOWED_ORIGINS: valor }, { Origin: origin })).headers.get('Access-Control-Allow-Origin');
  ok(await con('https://us.verexstore.com/', o) === o, 'barra final en la lista no rompe el origen');
  ok(await con('HTTPS://US.VEREXSTORE.COM', o) === o, 'mayúsculas en la lista no rompen el origen');
  ok(await con('"https://us.verexstore.com"', o) === o, 'comillas alrededor no rompen el origen');
  ok(await con('https://verexstore.com\nhttps://us.verexstore.com', o) === o, 'saltos de línea como separador');
  ok(await con('https://verexstore.com; https://us.verexstore.com ', o) === o, 'punto y coma y espacios como separador');
  ok(await con('https://verexstore.com,https://us.verexstore.com.evil.com', o) === null, 'no acepta dominios parecidos (us.verexstore.com.evil.com)');
  ok(await con('https://verexstore.com', o) === null, 'origen ausente de la lista sigue bloqueado'); }

// 10b. IP reenviada por las Functions de Pages (solo con secreto interno válido)
{ const cfg = { INTERNAL_SECRET: 's3creto' }; const shared = newIp();          // IP compartida de Cloudflare
  const viaFn = (pass, client, secret) => call({ accion: 'VERIFICAR_PASS', _pass: pass }, shared, cfg, { 'X-Verex-Client-IP': client, ...(secret ? { 'X-Verex-Internal': secret } : {}) });
  for (let i = 0; i < 5; i++) await viaFn('mala' + i, '198.51.100.7', 's3creto');
  ok((await viaFn(PASS, '198.51.100.7', 's3creto')).status === 429, 'Function con secreto: el atacante (IP real reenviada) queda bloqueado');
  ok((await viaFn(PASS, '198.51.100.8', 's3creto')).body.ok === true, 'Function con secreto: otro cliente NO queda bloqueado por el atacante (sin DoS)');
  const spoof = newIp();
  for (let i = 0; i < 5; i++) await call({ accion: 'VERIFICAR_PASS', _pass: 'x' + i }, spoof, cfg, { 'X-Verex-Client-IP': '10.0.0.' + i, 'X-Verex-Internal': 'falso' });
  ok((await call({ accion: 'VERIFICAR_PASS', _pass: PASS }, spoof, cfg, { 'X-Verex-Client-IP': '10.9.9.9', 'X-Verex-Internal': 'falso' })).status === 429, 'cabecera de IP falsificada sin secreto correcto se ignora (no evade el límite)');
  const noSecretCfg = newIp();
  for (let i = 0; i < 5; i++) await call({ accion: 'VERIFICAR_PASS', _pass: 'q' + i }, noSecretCfg, {}, { 'X-Verex-Client-IP': '10.1.1.' + i, 'X-Verex-Internal': 'cualquiera' });
  ok((await call({ accion: 'VERIFICAR_PASS', _pass: PASS }, noSecretCfg, {}, { 'X-Verex-Client-IP': '10.2.2.2' })).status === 429, 'sin INTERNAL_SECRET configurado en el Worker la cabecera nunca se usa'); }

// 11. Fail-open: si falla el almacén de intentos, el admin legítimo sigue entrando
{ failRl = true; const ip = newIp();
  ok((await login(PASS, ip)).body.ok === true, 'con el almacén de bloqueos caído, la contraseña correcta sigue entrando (fail-open)');
  failRl = false; }

// 12. Coste: el camino normal no multiplica las lecturas a Supabase
{ const ip = newIp(); await login(PASS, ip); const before = sbCalls;
  for (let i = 0; i < 20; i++) await call({ accion: 'GET_TIENDA', _pass: PASS }, ip);
  console.log('      lecturas a Supabase en 20 peticiones admin seguidas: ' + (sbCalls - before));
  ok(sbCalls - before < 20 * 6, 'sin lecturas extra por petición gracias a la caché local'); }

console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
