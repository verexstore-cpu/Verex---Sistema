// Simula la historia REAL: 2 intentos fallidos (Worker anterior, límite 50) + 1 intento bueno (Worker nuevo) + la corrección automática.
// Ejecutar:  OLD_WORKER=ruta/al/worker-viejo.js node test-reconciliacion.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const load = async (file, name) => { const t = path.join(os.tmpdir(), name); fs.copyFileSync(file, t); return (await import(pathToFileURL(t).href + '?t=' + Date.now())).default; };
const nuevo = await load(path.join(here, 'worker-firebase.js'), 'wk-nuevo.mjs');
const viejo = await load(process.env.OLD_WORKER || '/tmp/claude-0/worker-viejo.js', 'wk-viejo.mjs');      // Worker de los 2 intentos fallidos (commit fd9551e)
const tercero = await load(process.env.THIRD_WORKER || '/tmp/claude-0/worker-tercero.js', 'wk-tercero.mjs'); // Worker del 3.er intento (commit f04dbb9: ya en bloque, aún guardaba lo pedido)

const db = new Map(), emails = []; let sub = 0, LIM = 50, resendStatus = 200;
const k = (t, id) => t + '/' + id;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (++sub > LIM) throw new Error('Too many subrequests by single Worker invocation.');
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(opts.body)); return new Response(resendStatus === 200 ? '{}' : '{"message":"domain not verified"}', { status: resendStatus }); }
  if (!u.hostname.endsWith('sb.test')) return realFetch(url, opts);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  if (u.pathname === '/rest/v1/rpc/update_doc') { const kk = k(body.p_table, body.p_id); db.set(kk, { ...(db.get(kk) || {}), ...body.p_patch }); return ok({}); }
  const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/); if (!m) return ok([]);
  const table = m[1], idq = u.searchParams.get('id') || '';
  if (method === 'GET') {
    if (idq.startsWith('eq.')) { const id = idq.slice(3); const d = db.get(k(table, id)); return ok(d ? [{ id, data: d }] : []); }
    if (idq.startsWith('in.(')) { const ids = [...idq.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => decodeURIComponent(x[1])); return ok(ids.filter((i) => db.has(k(table, i))).map((i) => ({ id: i, data: db.get(k(table, i)) }))); }
    const all = [...db.keys()].filter((x) => x.startsWith(table + '/')).sort().map((x) => ({ id: x.slice(table.length + 1), data: db.get(x) }));
    const off = parseInt(u.searchParams.get('offset') || '0'), lim = parseInt(u.searchParams.get('limit') || '1000'); return ok(all.slice(off, off + lim));
  }
  if (method === 'POST') {
    const prefer = (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '';
    if (prefer.includes('ignore-duplicates')) { if (db.has(k(table, body.id))) return ok([]); db.set(k(table, body.id), body.data); return ok([{ id: body.id, data: body.data }]); }
    for (const r of (Array.isArray(body) ? body : [body])) db.set(k(table, r.id), r.data); return ok({});
  }
  if (method === 'DELETE') { db.delete(k(table, idq.slice(3))); return ok({}); }
  return ok({});
};
const realNow = Date.now.bind(Date); let fijo = null; Date.now = () => (fijo != null ? fijo : realNow());

const PASS = 'clave-prueba', IP = '203.0.113.9';
const N = 30, POS_VISTOS = { 3: 'ANP254T6', 7: 'ANP268T7' };
const codigoDe = (i) => POS_VISTOS[i] || 'COD' + String(i).padStart(2, '0');
const qDe = (i) => (i === 5 || i === 20 ? 2 : 1);
const otroVendedor = (i) => (i === 2 || i === 12 ? 2 : 0);            // otro vendedor (V2) con piezas pendientes del mismo producto

function escenario(opts = {}) {
  db.clear(); emails.length = 0; LIM = 50; resendStatus = 200;
  const items = [];
  for (let i = 1; i <= N; i++) {
    const c = opts.codigos ? opts.codigos(i) : codigoDe(i), q = qDe(i);
    db.set(k('consignacion', 'C' + i), { codigo: c, nombre: 'Producto ' + i, vendedor: 'V1', cantidad: q, vendido: 0, estado: 'activo' });
    if (otroVendedor(i)) db.set(k('consignacion', 'X' + i), { codigo: c, nombre: 'Producto ' + i, vendedor: 'V2', cantidad: otroVendedor(i), vendido: 0, estado: 'activo' });
    const b = POS_VISTOS[i] ? 0 : i % 4, t = 1, cons = q + otroVendedor(i);     // los códigos vistos eran piezas ÚNICAS (bodega 0 antes de devolverlas)
    db.set(k('stock', c), { codigo: c, nombre: 'Producto ' + i, stock_bodega: b, stock_tienda: t, stock_consignacion: cons, stock_total: b + t + cons });
    items.push({ id: 'C' + i, codigo: c, nombre: 'Producto ' + i, max: q, cantidad: q });
  }
  return items;
}
const envBase = (variante) => variante === 'A'
  ? { SUPABASE_URL: 'https://x.sb.test', SUPABASE_SERVICE_KEY: 'k', SECRET_PASS: PASS, RESEND_KEY: 'r' }
  : { SUPABASE_URL: 'https://x.sb.test', SUPABASE_SERVICE_KEY: 'k', RESEND_KEY: 'r' };
async function sha(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function intento(w, items, ts, variante) {
  sub = 0; fijo = ts;
  const pass = variante === 'A' ? PASS : await sha(PASS);
  const r = await w.fetch(new Request('https://api.test/', { method: 'POST', headers: { 'CF-Connecting-IP': IP }, body: JSON.stringify({ accion: 'REGISTRAR_DEVOLUCION', _pass: pass, vendedor: 'V1', items }) }), envBase(variante));
  fijo = null; return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function historia(variante, items) {
  if (variante !== 'A') db.set(k('config', 'settings'), { passHash: await sha(PASS) });
  if (variante === 'C') db.set(k('config', 'rl_api:' + IP), { n: 1, start: Date.now(), until: 0, strikes: 0 });   // fuerza una lectura extra (arranque más caro)
  await intento(viejo, items, 1790743111454, variante);
  await intento(viejo, items, 1790743149436, variante);
  await intento(tercero, items, 1790743887815, variante);
}
async function corregir(variante) { sub = 0; await nuevo.scheduled({ cron: '*/5 * * * *' }, envBase(variante), { waitUntil() {} }); }
const b0 = (i) => (POS_VISTOS[i] ? 0 : i % 4);
const ideal = () => { const o = {}; for (let i = 1; i <= N; i++) o[codigoDe(i)] = { bodega: b0(i) + qDe(i), consig: qDe(i) + otroVendedor(i) - qDe(i) }; return o; };
const estado = (c) => db.get(k('stock', c));
function comparar() { const id = ideal(); const malos = []; for (let i = 1; i <= N; i++) { const c = codigoDe(i), s = estado(c), e = id[c]; if (s.stock_bodega !== e.bodega || s.stock_consignacion !== e.consig || s.stock_total !== e.bodega + s.stock_tienda + e.consig) malos.push(`${i}:${c} bodega ${s.stock_bodega}/${e.bodega} consig ${s.stock_consignacion}/${e.consig}`); } return malos; }

let pass = 0, fail = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };
console.log('Corrección automática de la devolución fallida — pruebas\n');

for (const v of ['A', 'B', 'C']) {
  const desc = { A: 'contraseña en el Worker (arranque de 2 peticiones)', B: 'contraseña en Supabase (3)', C: 'arranque más caro (4): el producto 10 NO queda a medias' }[v];
  const items = escenario(); await historia(v, items);
  const antes = comparar();
  if (v === 'A') {
    const d = (i) => estado(codigoDe(i));
    console.log('      tras los 3 intentos: productos 1-9 con bodega de más, p.10 a medias — ejemplo p3: bodega ' + d(3).stock_bodega + ' (ideal ' + (b0(3) + 1) + '), p10: ' + d(10).stock_bodega + ' (ideal ' + ((10 % 4) + 1) + ')');
    ok(antes.length >= 9, 'la simulación reproduce el problema: ' + antes.length + ' productos NO cuadran antes de corregir (esperado ≥ 9)');
  }
  await corregir(v);
  const malos = comparar();
  ok(malos.length === 0, `[${v}] ${desc}: tras la corrección los ${N} productos cuadran con lo ideal` + (malos.length ? ' — ' + malos.slice(0, 3).join(' | ') : ''));
  const marca = db.get(k('config', 'fix_devolucion_20260930'));
  ok(marca && marca.estado === 'aplicado', `[${v}] marcador guardado (estado «${marca && marca.estado}»)`);
  ok(!db.has(k('devoluciones', 'DEV_1790743111454')) && !db.has(k('devoluciones', 'DEV_1790743149436')) && db.has(k('devoluciones', 'DEV_1790743887815')), `[${v}] se borran los 2 registros fallidos y queda el tercero`);
  const r3 = db.get(k('devoluciones', 'DEV_1790743887815'));
  ok(r3.total_unidades === Array.from({ length: N }, (_, i) => qDe(i + 1)).reduce((a, x) => a + x, 0), `[${v}] el registro que queda muestra ${r3.total_unidades} unidades (no 0)`);
  ok(emails.length === 1 && /aplicado/.test(emails[0].subject) && emails[0].to[0] === 'hola@verexstore.com', `[${v}] se envió UN correo de informe a hola@verexstore.com`);
  ok(Array.isArray(marca.antes) && marca.antes.length === marca.cambios.length && marca.respaldoRegistros.length === 2, `[${v}] copia de lo anterior guardada para deshacer (${marca.antes.length} productos)`);
  const foto = JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/')));
  await corregir(v);
  ok(JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))) === foto && emails.length === 1, `[${v}] una segunda ejecución NO cambia nada ni manda otro correo (idempotente)`);
  ok(sub <= 3, `[${v}] una vez aplicada, cada cron solo gasta ${sub} petición`);
  if (v === 'A') console.log('      cambios: ' + marca.cambios.length + ' productos · omitidos: ' + marca.omitidos.length + ' · ' + marca.cambios.map((c) => c.codigo).join(', '));
}

{ const items = escenario({ codigos: (i) => (i === 3 ? 'OTRO03' : i === 12 ? 'ANP254T6' : codigoDe(i) === 'ANP254T6' ? 'COD03' : codigoDe(i)) }); await historia('A', items);
  const snap = JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))); await corregir('A');
  ok(JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))) === snap && db.get(k('config', 'fix_devolucion_20260930')).estado === 'omitido', 'guarda: si el código visto duplicado NO está entre los 9 primeros, no cambia nada y avisa'); }

{ const items = escenario(); await historia('A', items); db.delete(k('devoluciones', 'DEV_1790743111454'));
  const snap = JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))); await corregir('A');
  ok(JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))) === snap && db.get(k('config', 'fix_devolucion_20260930')).estado === 'omitido', 'guarda: si falta un registro de los intentos fallidos, no cambia nada y avisa'); }

{ const items = escenario(); await historia('A', items);
  const vis = estado('ANP254T6'); db.set(k('stock', 'ANP254T6'), { ...vis, stock_bodega: 1, stock_total: 1 + vis.stock_tienda + vis.stock_consignacion });   // el usuario ya lo corrigió a mano
  const snap = JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))); await corregir('A');
  ok(JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/'))) === snap && db.get(k('config', 'fix_devolucion_20260930')).estado === 'omitido' && /ya no tienen 2/.test(db.get(k('config', 'fix_devolucion_20260930')).notas.join(' ')), 'guarda: si un código visto ya se corrigió a mano (bodega ≠ 2), no resta dos veces y avisa'); }

{ const items = escenario(); await historia('A', items);
  const c = codigoDe(4); db.set(k('stock', c), { ...estado(c), stock_bodega: 0, stock_total: 0 + estado(c).stock_tienda + estado(c).stock_consignacion });     // ya salió de bodega: se vendió/movió
  await corregir('A'); const marca = db.get(k('config', 'fix_devolucion_20260930'));
  ok(marca.omitidos.some((o) => o.codigo === c) && estado(c).stock_bodega === 0, 'guarda: un producto cuya bodega ya bajó (se vendió) NO se toca y se marca «revisar a mano»');
  ok(marca.cambios.length >= 7, 'y los demás productos sí se corrigen (' + marca.cambios.length + ')'); }


{ // Concurrencia: cron + dirección abierta a la vez => se aplica UNA sola vez
  const items = escenario(); await historia('A', items); LIM = 500;
  const get = () => nuevo.fetch(new Request('https://api.test/?fix=devolucion'), envBase('A'));
  await Promise.all([corregir('A'), corregir('A'), get(), get()]);
  ok(comparar().length === 0, 'concurrencia: 2 crons + 2 aperturas de la dirección a la vez dejan los 30 productos EXACTOS (aplicado una sola vez)');
  ok(emails.length === 1, 'concurrencia: un solo correo'); }

{ // Dirección de consulta: ejecuta si no corrió y devuelve el resumen (sin copias de datos)
  const items = escenario(); await historia('A', items); sub = 0;
  const r = await nuevo.fetch(new Request('https://api.test/?fix=devolucion'), envBase('A')); const j = await r.json();
  ok(r.status === 200 && j.estado === 'aplicado' && j.cambios.length === 10 && j.correo && j.correo.ok === true, 'dirección ?fix=devolucion: ejecuta la corrección y responde el resumen (estado «' + j.estado + '», ' + j.cambios.length + ' cambios, correo ok)');
  ok(!('antes' in j) && !('respaldoRegistros' in j), 'la respuesta pública NO incluye las copias de datos');
  ok(comparar().length === 0, 'y el stock queda exacto');
  const r2 = await nuevo.fetch(new Request('https://api.test/?fix=devolucion'), envBase('A')); const j2 = await r2.json();
  ok(j2.estado === 'aplicado' && emails.length === 1, 'abrirla otra vez solo consulta (no repite ni manda otro correo)'); }

{ // Si el correo falla, queda anotado por qué (y el stock igual se corrige)
  const items = escenario(); await historia('A', items); resendStatus = 403; await corregir('A');
  const mk = db.get(k('config', 'fix_devolucion_20260930'));
  ok(mk.estado === 'aplicado' && mk.correo && mk.correo.ok === false && /403/.test(mk.correo.error) && comparar().length === 0, 'correo rechazado (403): el stock se corrige igual y el motivo queda guardado («' + (mk.correo && mk.correo.error || '').slice(0, 40) + '…»)'); }

{ // Candado viejo sin marcador se reclama; uno reciente no
  let items = escenario(); await historia('A', items);
  db.set(k('config', 'fix_devolucion_20260930_lock'), { fecha: new Date().toISOString() }); const snap = JSON.stringify([...db.entries()].filter(([z]) => z.startsWith('stock/')));
  await corregir('A');
  ok(JSON.stringify([...db.entries()].filter(([z]) => z.startsWith('stock/'))) === snap && !db.has(k('config', 'fix_devolucion_20260930')), 'candado reciente sin marcador: otra ejecución está en curso, no hace nada');
  db.set(k('config', 'fix_devolucion_20260930_lock'), { fecha: new Date(Date.now() - 40 * 60000).toISOString() }); await corregir('A');
  ok(comparar().length === 0 && db.get(k('config', 'fix_devolucion_20260930')).estado === 'aplicado', 'candado de hace 40 min sin marcador: se reclama y se aplica'); }

{ // Marcador 'aplicando' (ejecución que murió a mitad): NO se reintenta
  const items = escenario(); await historia('A', items);
  db.set(k('config', 'fix_devolucion_20260930'), { estado: 'aplicando', fecha: new Date().toISOString(), antes: [] }); const snap = JSON.stringify([...db.entries()].filter(([z]) => z.startsWith('stock/')));
  await corregir('A');
  ok(JSON.stringify([...db.entries()].filter(([z]) => z.startsWith('stock/'))) === snap, 'marcador «aplicando»: no se reintenta (evita restar dos veces)'); }

console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
