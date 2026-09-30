// Pruebas de la auditoría diaria de stock (cron 0 14 * * *) y del aviso por WhatsApp. Supabase y CallMeBot simulados.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), 'verex-w-auditoria.mjs'); fs.copyFileSync(process.env.WORKER_FILE || path.join(here, 'worker-firebase.js'), tmp);
const worker = (await import(pathToFileURL(tmp).href + '?t=' + Date.now())).default;
const db = new Map(); const wa = []; let sub = 0, failStock = false;
const k = (t, id) => t + '/' + id; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.callmebot.com') { wa.push(decodeURIComponent(u.searchParams.get('text'))); return new Response('ok'); }
  if (!u.hostname.endsWith('sb.test')) return new Response('{}', { status: 200 });
  if (++sub > 50) throw new Error('Too many subrequests by single Worker invocation.');
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  if (u.pathname === '/rest/v1/rpc/update_doc') { const kk = k(body.p_table, body.p_id); db.set(kk, { ...(db.get(kk) || {}), ...body.p_patch }); return ok({}); }
  const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/); if (!m) return ok([]); const table = m[1];
  if (method === 'GET') { if (failStock && table === 'stock') return new Response('boom', { status: 500 });
    const off = parseInt(u.searchParams.get('offset') || '0'); if (off > 0) return ok([]);
    return ok([...db.keys()].filter((x) => x.startsWith(table + '/')).map((x) => ({ id: x.slice(table.length + 1), data: db.get(x) }))); }
  if (method === 'POST') { for (const r of (Array.isArray(body) ? body : [body])) db.set(k(table, r.id), r.data); return ok({}); }
  return ok({});
};
const env = { SUPABASE_URL: 'https://x.sb.test', SUPABASE_SERVICE_KEY: 'k', SECRET_PASS: 'p', CALLMEBOT_KEY: 'key' };
const st = (c, b, t, co, tot) => db.set(k('stock', c), { codigo: c, nombre: 'N' + c, stock_bodega: b, stock_tienda: t, stock_consignacion: co, stock_total: tot ?? b + t + co });
const cons = (id, c, cant, vend = 0, estado = 'activo') => db.set(k('consignacion', id), { codigo: c, vendedor: 'V1', cantidad: cant, vendido: vend, estado });
const correr = async () => { wa.length = 0; sub = 0; await worker.scheduled({ cron: '0 14 * * *' }, env, { waitUntil() {} }); return wa.join('\n---\n'); };
let pass = 0, fail = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };
console.log('Auditoría diaria de stock — pruebas\n');

{ db.clear(); for (let i = 1; i <= 40; i++) { st('A' + i, 3, 1, 2); cons('C' + i, 'A' + i, 2); }
  const msg = await correr(); const reg = db.get(k('config', 'auditoria_stock'));
  ok(!/Auditoría de stock/.test(msg) && wa.length === 0, 'inventario sano: NO manda WhatsApp (sin ruido)');
  ok(reg && reg.ok === true && reg.resumen.productosRevisados === 40, 'guarda el resultado en config/auditoria_stock (ok, 40 revisados)');
  ok(sub <= 20, 'peticiones a Supabase en el cron: ' + sub + ' (límite 50)'); }
{ db.clear(); st('B1', 3, 1, 2, 9); cons('CB1', 'B1', 2); st('B2', -1, 0, 0); st('B3', 2, 0, 3); cons('CB3', 'B3', 1); st('B4', 1, 0, 0); cons('CB5', 'NOEXISTE', 2);
  const msg = await correr();
  ok(/Auditoría de stock: \d+ producto/.test(msg), 'con descuadres: manda UN WhatsApp de auditoría');
  ok(/B1: total 9, suma 6/.test(msg), 'avisa stock_total que no suma (B1)');
  ok(/cantidades negativas/.test(msg) && /B2/.test(msg), 'avisa cantidades negativas (B2)');
  ok(/B3: Stock 3, vendedores 1/.test(msg), 'avisa Stock vs. vendedores (B3: 3 vs 1)');
  ok(/consignaciones de códigos que ya no existen/.test(msg), 'avisa consignaciones huérfanas');
  ok(/🔍 Auditoría/.test(msg), 'indica dónde ver el detalle');
  const reg = db.get(k('config', 'auditoria_stock')); ok(reg.ok === false && reg.muestra.totalDescuadrado.length === 1, 'el resultado guardado marca ok:false con muestra'); }
{ db.clear(); for (let i = 1; i <= 30; i++) { st('D' + i, 1, 0, 5, 99); }
  const msg = await correr(); ok(/… y 22 más/.test(msg) && msg.length < 1800, 'con muchos descuadres el mensaje se acorta (8 + «y 22 más»; ' + msg.length + ' caracteres)'); }
{ db.clear(); st('E1', 1, 0, 0); failStock = true; const msg = await correr(); failStock = false;
  ok(/NO pudo ejecutarse/.test(msg), 'si la auditoría falla, avisa por WhatsApp (no falla en silencio)'); }
{ db.clear(); st('F1', 1, 0, 0, 5); const r = await worker.fetch(new Request('https://api.test/', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.9' }, body: JSON.stringify({ accion: 'AUDITORIA_STOCK', _pass: 'p' }) }), env); const b = await r.json();
  ok(b.ok && b.resumen.totalDescuadrado === 1 && b.resumen.productosRevisados === 1, 'el botón 🔍 Auditoría del panel sigue funcionando y ahora también revisa el total'); }
console.log(`\n${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0);
