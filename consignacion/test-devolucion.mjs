// Pruebas de REGISTRAR_DEVOLUCION en bloque. Supabase simulado con el límite REAL de 50 subrequests por invocación.
// Ejecutar:  node test-devolucion.mjs     (WORKER_FILE=ruta para probar otra versión del Worker)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), 'verex-worker-devolucion.mjs');
fs.copyFileSync(process.env.WORKER_FILE || path.join(here, 'worker-firebase.js'), tmp);
const worker = (await import(pathToFileURL(tmp).href + '?t=' + Date.now())).default;

const LIMITE = 50;
const db = new Map(); let subrequests = 0, failStockWrite = false; const writes = [];
const k = (t, id) => t + '/' + id;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); if (!u.hostname.endsWith('sb.test')) return realFetch(url, opts);
  if (++subrequests > LIMITE) throw new Error('Too many subrequests by single Worker invocation.');
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  if (u.pathname === '/rest/v1/rpc/update_doc') { const kk = k(body.p_table, body.p_id); db.set(kk, { ...(db.get(kk) || {}), ...body.p_patch }); writes.push('patch ' + kk); return ok({}); }
  const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/); if (!m) return ok([]);
  const table = m[1], idq = u.searchParams.get('id') || '';
  if (method === 'GET') {
    if (idq.startsWith('eq.')) { const id = idq.slice(3); const d = db.get(k(table, id)); return ok(d ? [{ id, data: d }] : []); }
    if (idq.startsWith('in.(')) { const ids = [...idq.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => decodeURIComponent(x[1])); return ok(ids.filter((i) => db.has(k(table, i))).map((i) => ({ id: i, data: db.get(k(table, i)) }))); }
    return ok([]);
  }
  if (method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    if (failStockWrite && table === 'stock') return new Response('boom', { status: 500 });
    for (const r of rows) { db.set(k(table, r.id), r.data); writes.push('set ' + k(table, r.id)); } return ok({});
  }
  return ok({});
};

const PASS = 'clave-de-prueba';
const env = { SUPABASE_URL: 'https://x.sb.test', SUPABASE_SERVICE_KEY: 'k', SECRET_PASS: PASS };
let n = 0;
const devolver = async (payload, pass = PASS) => {
  subrequests = 0; writes.length = 0;
  const r = await worker.fetch(new Request('https://api.test/', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.' + (++n) }, body: JSON.stringify({ accion: 'REGISTRAR_DEVOLUCION', _pass: pass, ...payload }) }), env);
  return { status: r.status, body: await r.json().catch(() => ({})), sub: subrequests };
};
const reset = () => db.clear();
const mk = (i, cant = 1, vend = 0, bodega = 5, consig = 4, tienda = 2) => {
  db.set(k('consignacion', 'C' + i), { codigo: 'COD' + i, nombre: 'Prod ' + i, vendedor: 'V1', cantidad: cant, vendido: vend, estado: 'activo' });
  db.set(k('stock', 'COD' + i), { codigo: 'COD' + i, nombre: 'Prod ' + i, stock_bodega: bodega, stock_tienda: tienda, stock_consignacion: consig, stock_total: bodega + tienda + consig });
};
let pass = 0, fail = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };
console.log('Registrar devolución en bloque — pruebas\n');

{ reset(); for (let i = 1; i <= 30; i++) mk(i, 1 + (i % 3), 0, 5, 4 + (i % 3));
  const items = Array.from({ length: 30 }, (_, i) => ({ id: 'C' + (i + 1), codigo: 'COD' + (i + 1), cantidad: 1 + ((i + 1) % 3) }));
  const r = await devolver({ vendedor: 'V1', items });
  ok(r.body.ok === true, '30 productos en UNA devolución: ok (' + (r.body.error || 'sin error') + ')');
  ok(r.sub <= 20, 'peticiones a Supabase: ' + r.sub + ' (límite 50; antes eran ~155)');
  let bien = 0, total = 0, estados = 0;
  for (let i = 1; i <= 30; i++) { const c = 1 + (i % 3), s = db.get(k('stock', 'COD' + i)), co = db.get(k('consignacion', 'C' + i));
    if (s.stock_bodega === 5 + c && s.stock_consignacion === Math.max(0, 4 + (i % 3) - c)) bien++;
    if (s.stock_total === s.stock_bodega + s.stock_tienda + s.stock_consignacion) total++;
    if (co.cantidad === 0 && co.estado === 'devuelto') estados++; }
  ok(bien === 30, 'TODO lo devuelto regresó a bodega: 30/30 productos con stock_bodega + cantidad y stock_consignacion − cantidad');
  ok(total === 30, 'stock_total recalculado en los 30');
  ok(estados === 30, 'consignaciones quedan en 0 y estado «devuelto»: 30/30');
  ok(!!db.get(k('devoluciones', r.body.devolucionId)), 'queda UN registro en el historial de devoluciones');
  ok(r.body.devuelto.reduce((a, x) => a + x.cantidad, 0) === items.reduce((a, x) => a + x.cantidad, 0), 'el detalle devuelto suma lo pedido'); }

{ reset(); mk(1, 3, 1, 10, 3, 4);
  const r = await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 1 }] });
  const co = db.get(k('consignacion', 'C1')), s = db.get(k('stock', 'COD1'));
  ok(r.body.ok && co.cantidad === 2 && co.estado === 'activo', 'devolución parcial: consignación 3→2 y sigue «activo» (1 vendida)');
  ok(s.stock_bodega === 11 && s.stock_consignacion === 2 && s.stock_tienda === 4 && s.stock_total === 17, 'stock: bodega 10→11, consignación 3→2, tienda intacta, total 17'); }

{ reset(); mk(1, 2, 0, 5, 4); mk(2, 3, 0, 5, 4); db.set(k('consignacion', 'C2'), { ...db.get(k('consignacion', 'C2')), codigo: 'COD1' });
  const r = await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 2 }, { id: 'C2', codigo: 'COD1', cantidad: 3 }] });
  const s = db.get(k('stock', 'COD1'));
  ok(r.body.ok && s.stock_bodega === 10 && s.stock_consignacion === 0, 'dos registros del MISMO código se suman bien (5+2+3=10 en bodega; 4−5 se queda en 0, sin negativos)'); }

{ reset(); mk(1, 2, 0, 5, 4);
  const r = await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 5 }] });
  const s = db.get(k('stock', 'COD1'));
  ok(r.body.ok && s.stock_bodega === 7 && r.body.advertencias.length === 1, 'pedir más de lo disponible se recorta (solo 2) y avisa; el stock no se infla (5→7)'); }

{ reset(); mk(1, 1); mk(2, 1); db.delete(k('stock', 'COD2'));
  const antes = JSON.stringify([db.get(k('consignacion', 'C1')), db.get(k('stock', 'COD1'))]);
  const r = await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 1 }, { id: 'C2', codigo: 'COD2', cantidad: 1 }] });
  ok(r.body.ok === false && /COD2/.test(r.body.error), 'un producto sin registro en Stock: se rechaza todo y nombra el código («' + (r.body.error || '').slice(0, 50) + '…»)');
  ok(JSON.stringify([db.get(k('consignacion', 'C1')), db.get(k('stock', 'COD1'))]) === antes && r.body.devolucionId === undefined, 'y no se modificó nada (todo o nada)'); }

{ reset(); mk(1, 2, 0, 5, 4);
  const p = { vendedor: 'V1', devId: 'DEV_1700000000000_abc123', items: [{ id: 'C1', codigo: 'COD1', cantidad: 2 }] };
  await devolver(p); const despues1 = JSON.stringify(db.get(k('stock', 'COD1')));
  const r2 = await devolver(p);
  ok(r2.body.ok && r2.body.duplicado === true && JSON.stringify(db.get(k('stock', 'COD1'))) === despues1, 'reenviar la misma devolución (mismo devId) NO se aplica dos veces'); }

{ reset(); mk(1, 2, 0, 5, 4); mk(2, 2, 0, 5, 4); failStockWrite = true;
  const antesC = JSON.stringify([db.get(k('consignacion', 'C1')), db.get(k('consignacion', 'C2'))]), antesS = JSON.stringify([db.get(k('stock', 'COD1')), db.get(k('stock', 'COD2'))]);
  const r = await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 2 }, { id: 'C2', codigo: 'COD2', cantidad: 2 }] });
  failStockWrite = false;
  ok(r.body.ok === false && /stock/i.test(r.body.error), 'si falla la escritura del stock: error claro');
  ok(JSON.stringify([db.get(k('consignacion', 'C1')), db.get(k('consignacion', 'C2'))]) === antesC && JSON.stringify([db.get(k('stock', 'COD1')), db.get(k('stock', 'COD2'))]) === antesS, 'la consignación se deshace: nada queda a medias'); }

{ reset(); const N = 150; for (let i = 1; i <= N; i++) mk(i);
  const r = await devolver({ vendedor: 'V1', items: Array.from({ length: N }, (_, i) => ({ id: 'C' + (i + 1), codigo: 'COD' + (i + 1), cantidad: 1 })) });
  let bien = 0; for (let i = 1; i <= N; i++) if (db.get(k('stock', 'COD' + i)).stock_bodega === 6) bien++;
  ok(r.body.ok && bien === N && r.sub < LIMITE, '150 productos: todos a bodega (' + bien + '/150) con ' + r.sub + ' peticiones'); }

{ reset(); mk(1);
  ok((await devolver({ vendedor: 'V1', items: [] })).body.ok === false, 'sin productos: error claro');
  ok((await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 0 }] })).body.ok === false, 'cantidad 0: se ignora (antes se convertía en 1)');
  const r = await devolver({ vendedor: 'V1', items: [{ id: 'C1', codigo: 'COD1', cantidad: 1 }] }, 'mala');
  ok(r.status === 403 && db.get(k('stock', 'COD1')).stock_bodega === 5, 'sin contraseña válida: 403 y no se toca el stock'); }

console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
