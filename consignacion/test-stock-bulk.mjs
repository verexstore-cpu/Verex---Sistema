// Pruebas de los movimientos de stock en bloque (entrega, asignar tienda/vendedor, devolver a bodega).
// Supabase simulado con el límite REAL de 50 subrequests. Incluye comparación contra el Worker anterior (WORKER_ANTERIOR=ruta).
// Ejecutar:  node test-stock-bulk.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cargar = async (file, nombre) => { const t = path.join(os.tmpdir(), nombre); fs.copyFileSync(file, t); return (await import(pathToFileURL(t).href + '?t=' + Date.now())).default; };
const nuevo = await cargar(process.env.WORKER_FILE || path.join(here, 'worker-firebase.js'), 'verex-w-nuevo.mjs');
const viejo = process.env.WORKER_ANTERIOR ? await cargar(process.env.WORKER_ANTERIOR, 'verex-w-viejo.mjs') : null;

let LIMITE = 50;
const db = new Map(); let sub = 0, failStock = false, failNth = 0, failTabla = '', nStock = 0;
const k = (t, id) => t + '/' + id;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); if (!u.hostname.endsWith('sb.test')) return realFetch(url, opts);
  if (++sub > LIMITE) throw new Error('Too many subrequests by single Worker invocation.');
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  if (u.pathname === '/rest/v1/rpc/update_doc') { const kk = k(body.p_table, body.p_id); db.set(kk, { ...(db.get(kk) || {}), ...body.p_patch }); return ok({}); }
  const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/); if (!m) return ok([]);
  const table = m[1], idq = u.searchParams.get('id') || '';
  const ids = () => [...idq.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => decodeURIComponent(x[1]));
  if (method === 'GET') {
    if (idq.startsWith('eq.')) { const id = idq.slice(3); const d = db.get(k(table, id)); return ok(d ? [{ id, data: d }] : []); }
    if (idq.startsWith('in.(')) return ok(ids().filter((i) => db.has(k(table, i))).map((i) => ({ id: i, data: db.get(k(table, i)) })));
    return ok([...db.keys()].filter((x) => x.startsWith(table + '/')).map((x) => ({ id: x.slice(table.length + 1), data: db.get(x) })));
  }
  if (method === 'DELETE') { if (idq.startsWith('in.(')) ids().forEach((i) => db.delete(k(table, i))); else if (idq.startsWith('eq.')) db.delete(k(table, idq.slice(3))); return ok({}); }
  if (method === 'POST') {
    if (failStock && table === 'stock') return new Response('boom', { status: 500 });
    if (table === 'stock' && failNth && ++nStock === failNth) return new Response('boom', { status: 500 });
    if (failTabla && table === failTabla) return new Response('boom', { status: 500 });
    for (const r of (Array.isArray(body) ? body : [body])) db.set(k(table, r.id), r.data); return ok({});
  }
  return ok({});
};

const PASS = 'clave-de-prueba', env = { SUPABASE_URL: 'https://x.sb.test', SUPABASE_SERVICE_KEY: 'k', SECRET_PASS: PASS };
let n = 0;
const llamar = async (w, accion, payload, pass = PASS) => {
  sub = 0; const r = await w.fetch(new Request('https://api.test/', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.' + (++n % 250) }, body: JSON.stringify({ accion, _pass: pass, ...payload }) }), env);
  return { status: r.status, body: await r.json().catch(() => ({})), sub };
};
const mkStock = (i, b = 5, t = 2, c = 1) => db.set(k('stock', 'P' + i), { codigo: 'P' + i, nombre: 'Prod ' + i, precio: 10 * i, stock_bodega: b, stock_tienda: t, stock_consignacion: c, stock_total: b + t + c });
const snap = () => JSON.stringify([...db.entries()].filter(([x]) => x.startsWith('stock/')).sort(([a], [b]) => a.localeCompare(b)));
const limpiarCons = () => [...db.entries()].filter(([x]) => x.startsWith('consignacion/')).map(([, v]) => { const { fecha, ...r } = v; return r; }).sort((a, b) => a.codigo.localeCompare(b.codigo));
let pass = 0, fail = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };
const cods = (N) => Array.from({ length: N }, (_, i) => 'P' + (i + 1));
console.log('Movimientos de stock en bloque — pruebas\n');

// ── Comparación contra el Worker anterior (mismo resultado final con pocos productos)
if (viejo) {
  const casos = [
    ['STOCK_ASIGNAR_TIENDA', { codigos: [...cods(6), 'NOEXISTE'], cantidad: 2 }],
    ['STOCK_DEVOLVER_BODEGA', { codigos: cods(6), origen: 'tienda', cantidad: 2 }],
    ['STOCK_DEVOLVER_BODEGA', { codigos: cods(6), origen: 'consignacion', cantidad: 3 }],
    ['STOCK_ASIGNAR_VENDEDOR', { codigos: [...cods(6), 'NOEXISTE'], vendedor: 'V1', cantidad: 2 }],
    ['REGISTRAR_ENTREGA', { vendedor: 'V1', items: [...cods(5).map((c, i) => ({ codigo: c, nombre: 'Prod', cantidad: i + 1, id: 'E' + i, precio: 7 })), { codigo: 'SINSTOCK', nombre: 'x', cantidad: 1, id: 'Ex' }] }],
    ['REGISTRAR_ENTREGA', { vendedor: 'V1', borrador: true, items: [{ codigo: 'P1', nombre: 'a', cantidad: 9, id: 'B1' }] }],
  ];
  for (const [acc, p] of casos) {
    const res = [];
    for (const w of [viejo, nuevo]) {
      db.clear(); cods(6).forEach((c, i) => mkStock(i + 1, i, i % 3, i % 4)); // incluye stock 0 y bajos
      const r = await llamar(w, acc, p); res.push({ snap: snap(), cons: JSON.stringify(limpiarCons()), ok: r.body.ok });
    }
    ok(res[0].snap === res[1].snap && res[0].cons === res[1].cons && res[0].ok === res[1].ok, `igual que el Worker anterior: ${acc} ${p.borrador ? '(borrador)' : ''}${p.origen ? ' desde ' + p.origen : ''}`);
  }
} else console.log('  (sin WORKER_ANTERIOR: se omite la comparación)');

// ── Escala: 30 y 150 productos bajo el límite de 50
for (const N of [30, 150]) {
  for (const [acc, mk, p, chk] of [
    ['STOCK_ASIGNAR_TIENDA', () => cods(N).forEach((c, i) => mkStock(i + 1, 5, 0, 0)), { codigos: cods(N), cantidad: 1 }, (s) => s.stock_bodega === 4 && s.stock_tienda === 1 && s.stock_total === 5],
    ['STOCK_DEVOLVER_BODEGA', () => cods(N).forEach((c, i) => mkStock(i + 1, 5, 3, 0)), { codigos: cods(N), origen: 'tienda', cantidad: 1 }, (s) => s.stock_bodega === 6 && s.stock_tienda === 2 && s.stock_total === 8],
    ['STOCK_ASIGNAR_VENDEDOR', () => cods(N).forEach((c, i) => mkStock(i + 1, 5, 0, 0)), { codigos: cods(N), vendedor: 'V1', cantidad: 1 }, (s) => s.stock_bodega === 4 && s.stock_consignacion === 1],
    ['REGISTRAR_ENTREGA', () => cods(N).forEach((c, i) => mkStock(i + 1, 5, 0, 0)), { vendedor: 'V1', items: cods(N).map((c) => ({ codigo: c, nombre: 'x', cantidad: 1 })) }, (s) => s.stock_bodega === 4 && s.stock_consignacion === 1],
  ]) {
    db.clear(); mk(); const r = await llamar(nuevo, acc, p);
    const bien = cods(N).filter((c) => chk(db.get(k('stock', c)))).length;
    ok(r.body.ok === true && bien === N && r.sub <= 12, `${acc} con ${N} productos: ${bien}/${N} correctos con ${r.sub} peticiones (límite 50)`);
    if (acc.includes('VENDEDOR') || acc === 'REGISTRAR_ENTREGA') ok([...db.keys()].filter((x) => x.startsWith('consignacion/')).length === N, `  …y ${N} registros de consignación creados`);
  }
}

// ── Reglas
{ db.clear(); mkStock(1, 2, 0, 0);
  await llamar(nuevo, 'STOCK_ASIGNAR_TIENDA', { codigos: ['P1'], cantidad: 10 });
  const s = db.get(k('stock', 'P1')); ok(s.stock_bodega === 0 && s.stock_tienda === 2, 'asignar a tienda: no mueve más de lo que hay en bodega (2 de 10)'); }
{ db.clear(); mkStock(1, 0, 0, 0); const r = await llamar(nuevo, 'STOCK_ASIGNAR_VENDEDOR', { codigos: ['P1', 'X'], vendedor: 'V1' });
  ok(r.body.ok && r.body.asignados.length === 0 && r.body.sinStock.length === 2 && ![...db.keys()].some((x) => x.startsWith('consignacion/')), 'asignar a vendedor sin stock: reporta sinStock y no crea consignación'); }
{ db.clear(); mkStock(1, 3, 0, 0); const r = await llamar(nuevo, 'STOCK_ASIGNAR_VENDEDOR', { codigos: ['P1', 'P1'], vendedor: 'V1', cantidad: 2 });
  const s = db.get(k('stock', 'P1')); const nc = [...db.keys()].filter((x) => x.startsWith('consignacion/')).length;
  ok(r.body.ok && s.stock_bodega === 0 && s.stock_consignacion === 3 && nc === 2 && s.stock_total === 3, 'código repetido en la lista: 2 registros con ids distintos y el stock nunca queda negativo (2 + 1)'); }
{ db.clear(); mkStock(1, 3, 0, 0); const r = await llamar(nuevo, 'REGISTRAR_ENTREGA', { vendedor: 'V1', items: [{ codigo: 'P1', cantidad: 1, id: 'A' }, { codigo: 'P1', cantidad: 1, id: 'A' }, { codigo: '', cantidad: 1 }, { codigo: 'P1', cantidad: -2, id: 'C' }] });
  ok(r.body.ok === false && r.body.guardados.length === 1 && r.body.fallidos.length === 3 && db.get(k('stock', 'P1')).stock_consignacion === 1, 'entrega con ítems inválidos: guarda el válido y reporta 3 fallidos (repetido, sin código, cantidad inválida)'); }
{ db.clear(); mkStock(1, 3, 0, 0); const r = await llamar(nuevo, 'REGISTRAR_ENTREGA', { vendedor: 'V1', items: [{ codigo: 'P1', cantidad: 1, id: 'A' }] }, 'mala');
  ok(r.status === 403 && db.get(k('stock', 'P1')).stock_bodega === 3, 'sin clave de admin: 403 y nada cambia'); }

// ── Todo o nada si falla el stock
for (const [acc, p] of [['STOCK_ASIGNAR_VENDEDOR', { codigos: ['P1', 'P2'], vendedor: 'V1' }], ['REGISTRAR_ENTREGA', { vendedor: 'V1', items: [{ codigo: 'P1', cantidad: 1, id: 'N1' }, { codigo: 'P2', cantidad: 1, id: 'N2' }] }]]) {
  db.clear(); mkStock(1); mkStock(2); db.set(k('consignacion', 'N1'), { codigo: 'P1', vendedor: 'V1', cantidad: 9, vendido: 0, estado: 'activo' });
  const antes = snap(), previo = JSON.stringify(db.get(k('consignacion', 'N1'))); failStock = true; const r = await llamar(nuevo, acc, p); failStock = false;
  const consIds = [...db.keys()].filter((x) => x.startsWith('consignacion/'));
  ok(r.body.ok === false && snap() === antes, `${acc}: si falla el stock, el stock queda intacto y se avisa «no se guardó nada»`);
  ok(consIds.length === 1 && JSON.stringify(db.get(k('consignacion', 'N1'))) === previo, `${acc}: la consignación se deshace (se borra lo nuevo y se restaura lo previo)`); }

// ── Correcciones tras la simulación independiente
{ // 1) más de 100 productos: si falla el 2.º bloque de stock se deshace todo (antes quedaban 100 a medias)
  for (const [acc, p, chk] of [
    ['STOCK_ASIGNAR_TIENDA', { codigos: cods(110), cantidad: 1 }, null],
    ['STOCK_ASIGNAR_VENDEDOR', { codigos: cods(110), vendedor: 'V1', cantidad: 1 }, 'cons'],
    ['REGISTRAR_ENTREGA', { vendedor: 'V1', items: cods(110).map((c) => ({ codigo: c, nombre: 'x', cantidad: 1 })) }, 'cons'],
  ]) {
    db.clear(); cods(110).forEach((c, i) => mkStock(i + 1, 5, 0, 0)); const antes = snap();
    nStock = 0; failNth = 2; const r = await llamar(nuevo, acc, p); failNth = 0;
    ok(r.body.ok === false && snap() === antes, `${acc} con 110 productos y fallo en el 2.º bloque: error claro y stock intacto (antes quedaban 100 movidos)`);
    if (chk) ok(![...db.keys()].some((x) => x.startsWith('consignacion/')), `  …y sin registros de consignación sueltos`);
    const r2 = await llamar(nuevo, acc, p); ok(r2.body.ok === true && db.get(k('stock', 'P110')).stock_bodega === 4 && db.get(k('stock', 'P1')).stock_bodega === 4, `  …y el reintento funciona (110/110)`);
  } }
{ // 2) ids únicos aunque dos asignaciones caigan en el mismo milisegundo
  const fijo = Date.now; Date.now = () => 1700000000000;
  try { db.clear(); mkStock(1, 6, 0, 0); await llamar(nuevo, 'STOCK_ASIGNAR_VENDEDOR', { codigos: ['P1'], vendedor: 'V1', cantidad: 1 }); await llamar(nuevo, 'STOCK_ASIGNAR_VENDEDOR', { codigos: ['P1'], vendedor: 'V2', cantidad: 1 });
    const cons = [...db.entries()].filter(([x]) => x.startsWith('consignacion/')).map(([, v]) => v);
    ok(cons.length === 2 && new Set(cons.map((c) => c.vendedor)).size === 2 && db.get(k('stock', 'P1')).stock_consignacion === 2, 'dos asignaciones del mismo código en el mismo milisegundo: 2 registros (V1 y V2), ninguno se pisa'); }
  finally { Date.now = fijo; } }
{ // 3) devolución: si el historial no se puede guardar, NO se aplica nada y el reintento funciona
  db.clear(); db.set(k('consignacion', 'C1'), { codigo: 'P1', vendedor: 'V1', cantidad: 4, vendido: 0, estado: 'activo' }); mkStock(1, 5, 0, 4);
  const antes = snap(), antesC = JSON.stringify(db.get(k('consignacion', 'C1')));
  const p = { vendedor: 'V1', devId: 'DEV_1700000000000_zzz111', items: [{ id: 'C1', codigo: 'P1', cantidad: 2 }] };
  failTabla = 'devoluciones'; const r = await llamar(nuevo, 'REGISTRAR_DEVOLUCION', p); failTabla = '';
  ok(r.body.ok === false && snap() === antes && JSON.stringify(db.get(k('consignacion', 'C1'))) === antesC, 'devolución con fallo al guardar el historial: error y NADA aplicado');
  const r2 = await llamar(nuevo, 'REGISTRAR_DEVOLUCION', p); const r3 = await llamar(nuevo, 'REGISTRAR_DEVOLUCION', p);
  ok(r2.body.ok && db.get(k('stock', 'P1')).stock_bodega === 7 && r3.body.duplicado === true && db.get(k('stock', 'P1')).stock_bodega === 7, 'el reintento aplica 2 (bodega 5→7) y un reenvío posterior se detecta como duplicado');
  db.clear(); db.set(k('consignacion', 'C1'), { codigo: 'P1', vendedor: 'V1', cantidad: 4, vendido: 0, estado: 'activo' }); mkStock(1, 5, 0, 4);
  failStock = true; const r4 = await llamar(nuevo, 'REGISTRAR_DEVOLUCION', p); failStock = false;
  ok(r4.body.ok === false && ![...db.keys()].some((x) => x.startsWith('devoluciones/')) && db.get(k('consignacion', 'C1')).cantidad === 4, 'devolución con fallo de stock: se deshace todo, incluido el registro del historial (el reintento no sale como duplicado)');
  const r5 = await llamar(nuevo, 'REGISTRAR_DEVOLUCION', p); ok(r5.body.ok === true && !r5.body.duplicado && db.get(k('stock', 'P1')).stock_bodega === 7, 'y el reintento posterior sí se aplica'); }

{ // Cambiar la foto de un producto borra la "mejorada" vieja (si no, la pantalla seguía mostrando la foto anterior)
  db.clear(); db.set(k('stock', 'F1'), { codigo: 'F1', nombre: 'N', foto: 'https://ik.test/a.webp', fotoMejorada: 'https://ik.test/a.webp?tr=w-1600,e-sharpen-1', fotoMejoraNivel: 'natural', stock_bodega: 1 });
  await llamar(nuevo, 'EDITAR_PRODUCTO', { codigo: 'F1', nombre: 'N', img: 'https://ik.test/a.webp' });
  ok(db.get(k('stock', 'F1')).fotoMejorada.includes('e-sharpen-1'), 'editar SIN cambiar la foto conserva la mejorada');
  await llamar(nuevo, 'EDITAR_PRODUCTO', { codigo: 'F1', img: 'https://ik.test/NUEVA.webp' });
  const f = db.get(k('stock', 'F1')); ok(f.foto.endsWith('NUEVA.webp') && f.fotoMejorada === '' && f.fotoMejoraNivel === '', 'cambiar la foto guarda la nueva y borra la mejorada anterior');
  await llamar(nuevo, 'EDITAR_PRODUCTO', { codigo: 'F1', img: 'https://ik.test/OTRA.webp', fotoMejorada: 'https://ik.test/OTRA.webp?tr=w-1600,e-sharpen-3', fotoMejoraNivel: 'mejorado' });
  ok(db.get(k('stock', 'F1')).fotoMejorada.includes('OTRA') , 'si la misma petición trae una mejorada nueva, se respeta'); }

console.log(`\n${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0);
