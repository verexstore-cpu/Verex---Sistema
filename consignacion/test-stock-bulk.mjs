// Pruebas de los movimientos de stock en bloque (entrega, asignar tienda/vendedor, devolver a bodega).
// Supabase simulado con el límite REAL de 50 subrequests. Incluye comparación contra el Worker anterior (WORKER_ANTERIOR=ruta).
// Ejecutar:  node test-stock-bulk.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const cargar = async (file, nombre) => { const t = path.join(os.tmpdir(), nombre); fs.copyFileSync(file, t); return (await import(pathToFileURL(t).href + '?t=' + Date.now())).default; };
const nuevo = await cargar(process.env.WORKER_FILE || path.join(here, 'worker-firebase.js'), 'verex-w-nuevo.mjs');
const viejo = process.env.WORKER_ANTERIOR ? await cargar(process.env.WORKER_ANTERIOR, 'verex-w-viejo.mjs') : null;

let LIMITE = 50;
const db = new Map(); let sub = 0, failRpc = false, failStock = false, failNth = 0, failTabla = '', nStock = 0;
const k = (t, id) => t + '/' + id;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); if (!u.hostname.endsWith('sb.test')) return realFetch(url, opts);
  if (++sub > LIMITE) throw new Error('Too many subrequests by single Worker invocation.');
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  if (u.pathname === '/rest/v1/rpc/update_doc') { const kk = k(body.p_table, body.p_id); db.set(kk, { ...(db.get(kk) || {}), ...body.p_patch }); return ok({}); }
  if (u.pathname === '/rest/v1/rpc/reservar_stock_pedido') {
    if (failRpc) return new Response('rpc caída', { status: 500 });          // reserva atómica: primero tienda, luego bodega (como en Supabase)
    const kk = k('stock', body.p_id), dd = db.get(kk); if (!dd) return ok({ ok: false, error: 'no_existe' });
    const t = parseInt(dd.stock_tienda) || 0, b = parseInt(dd.stock_bodega) || 0, c = body.p_cantidad;
    if (t + b < c) return ok({ ok: false, error: 'sin_stock' });
    const dT = Math.min(t, c), dB = c - dT;
    db.set(kk, { ...dd, stock_tienda: t - dT, stock_bodega: b - dB, stock_reservado: (parseInt(dd.stock_reservado) || 0) + c }); return ok({ ok: true, desc_tienda: dT, desc_bodega: dB });
  }
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

{ // Publicar en tienda SIN mover inventario
  db.clear(); mkStock(1, 5, 0, 0); mkStock(2, 3, 2, 1); mkStock(3, 0, 0, 0); mkStock(4, 4, 0, 0);
  db.set(k('stock', 'P2'), { ...db.get(k('stock', 'P2')), enCatalogo: true }); db.set(k('stock', 'P4'), { ...db.get(k('stock', 'P4')), estado: 'inactivo' });
  const antes = JSON.stringify(['P1', 'P2', 'P3', 'P4'].map(c => { const { enCatalogo, ...r } = db.get(k('stock', c)); return r; }));
  const r = await llamar(nuevo, 'STOCK_PUBLICAR_VISIBLE', { codigos: ['P1', 'P2', 'P3', 'P4', 'NOEXISTE', 'P1'] });
  const desp = JSON.stringify(['P1', 'P2', 'P3', 'P4'].map(c => { const { enCatalogo, ...r } = db.get(k('stock', c)); return r; }));
  ok(r.body.ok && r.body.cambiados.join() === 'P1,P3' && r.body.yaEstaban.join() === 'P2' && r.body.inactivos.join() === 'P4' && r.body.noExisten.join() === 'NOEXISTE', 'publicar: marca P1 y P3, P2 ya estaba, P4 inactivo se respeta, código inexistente se informa');
  ok(db.get(k('stock', 'P1')).enCatalogo === true && db.get(k('stock', 'P3')).enCatalogo === true && !db.get(k('stock', 'P4')).enCatalogo, 'quedan visibles en la tienda (enCatalogo) y el inactivo no');
  ok(antes === desp, 'el inventario NO se mueve: bodega, tienda, consignación y total idénticos');
  ok(r.sub <= 3, 'peticiones: ' + r.sub);
  const o = await llamar(nuevo, 'STOCK_PUBLICAR_VISIBLE', { codigos: ['P1'], visible: false }); ok(o.body.ok && db.get(k('stock', 'P1')).enCatalogo === false, 'visible:false lo oculta de la tienda');
  const g = await llamar(nuevo, 'STOCK_PUBLICAR_VISIBLE', { codigos: cods(300).map((c, i) => c) }); ok(g.body.ok && g.sub <= 12, '300 códigos en una sola operación: ' + g.sub + ' peticiones');
  const m = await llamar(nuevo, 'STOCK_PUBLICAR_VISIBLE', { codigos: ['P1'] }, 'mala'); ok(m.status === 403, 'sin clave de admin: 403'); }

// ── Venta directa: descuento atómico
{ const vd = (items, extra = {}) => llamar(nuevo, 'REGISTRAR_VENTA_DIRECTA', { id: 'VD_' + Math.random().toString(36).slice(2), cliente: 'C', items: items.map(([codigo, cantidad]) => ({ codigo, nombre: 'n', precio: 5, cantidad })), total: 5, ...extra });
  const S = (c) => db.get(k('stock', c));
  db.clear(); mkStock(1, 5, 2, 0); mkStock(2, 4, 0, 1); mkStock(3, 1, 0, 0); mkStock(4, 0, 0, 0);
  let r = await vd([['P1', 3]]);
  ok(r.body.ok && S('P1').stock_tienda === 0 && S('P1').stock_bodega === 4 && S('P1').stock_vendido === 3 && (S('P1').stock_reservado || 0) === 0 && S('P1').stock_total === 4, 'venta de 3 con tienda 2 + bodega 5: sale primero de tienda (2) y luego de bodega (1); vendido +3, reservado en 0, total recalculado (4)');
  r = await vd([['P2', 1]]); ok(S('P2').stock_bodega === 3 && S('P2').stock_total === 4 && S('P2').stock_consignacion === 1, 'solo bodega: descuenta de bodega y NO toca consignación');
  r = await vd([['P3', 3]]);
  ok(r.body.ok && S('P3').stock_bodega === 0 && S('P3').stock_vendido === 3 && r.body.faltantes.length === 1 && r.body.faltantes[0].descontado === 1 && r.body.faltantes[0].vendido === 3, 'se vendió 3 con 1 en stock: descuenta solo 1, nunca negativo, y avisa en «faltantes» (vendido 3, descontado 1)');
  r = await vd([['P4', 1]]); ok(r.body.ok && r.body.faltantes[0].descontado === 0 && S('P4').stock_bodega === 0 && S('P4').stock_vendido === 1, 'sin stock: la venta se registra igual y se avisa (descontado 0)');
  r = await vd([['NOEXISTE', 1], ['P2', 1], ['P2', 1], ['', 1]]);
  ok(r.body.ok && r.body.itemsSinStock.includes('NOEXISTE') && r.body.itemsSinStock.includes('SIN_CODIGO') && S('P2').stock_bodega === 1 && S('P2').stock_vendido === 3, 'ficha inexistente y sin código se informan; el mismo código repetido se suma (2 más → bodega 1)');
  db.clear(); mkStock(1, 1, 0, 0);
  const [a, b] = await Promise.all([vd([['P1', 1]]), vd([['P1', 1]])]);
  const descTot = [a, b].reduce((n, x) => n + (x.body.faltantes.some(f => f.descontado === 0) ? 0 : 1), 0);
  ok(a.body.ok && b.body.ok && S('P1').stock_bodega === 0 && S('P1').stock_vendido === 2 && descTot === 1 && [a, b].filter(x => x.body.faltantes.length).length === 1, 'DOS ventas simultáneas de la última unidad: solo una descuenta, la otra queda avisada como «faltante»; stock 0 (nunca negativo) y vendido 2');
  LIMITE = 1000;                                        // el contador del simulador es global: con ventas simultáneas sumaría las peticiones de todas
  const rr = await Promise.all(Array.from({ length: 8 }, () => vd([['P1', 1]]))); LIMITE = 50;
  ok(S('P1').stock_bodega === 0 && rr.every(x => x.body.ok), '8 ventas simultáneas sobre stock 0: todas registradas, ninguna negativa');
  db.clear(); for (let i = 1; i <= 12; i++) mkStock(i, 5, 0, 0);
  r = await vd(Array.from({ length: 12 }, (_, i) => ['P' + (i + 1), 1]));
  ok(r.body.ok && r.sub < 50 && Array.from({ length: 12 }, (_, i) => S('P' + (i + 1)).stock_bodega).every(v => v === 4), 'venta de 12 productos distintos: todos descontados con ' + r.sub + ' peticiones (límite 50)');
  db.clear(); mkStock(1, 3, 0, 0); const m = await llamar(nuevo, 'REGISTRAR_VENTA_DIRECTA', { id: 'X', items: [{ codigo: 'P1', cantidad: 1 }] }, 'mala'); ok(m.status === 403 && S('P1').stock_bodega === 3, 'sin clave de admin: 403 y no se descuenta nada'); }
{ // si la reserva atómica falla por un error de Supabase, la venta NO se queda sin descontar (respaldo clásico)
  db.clear(); mkStock(1, 3, 1, 0); failRpc = true; const r = await llamar(nuevo, 'REGISTRAR_VENTA_DIRECTA', { id: 'VDX', cliente: 'C', items: [{ codigo: 'P1', cantidad: 3, nombre: 'n', precio: 5 }], total: 15 }); failRpc = false;
  const s1 = db.get(k('stock', 'P1')); ok(r.body.ok && (r.body.faltantes || []).length === 0 && s1.stock_tienda === 0 && s1.stock_bodega === 1 && s1.stock_vendido === 3 && (s1.stock_reservado || 0) === 0, 'si la reserva atómica falla por error de Supabase: descuenta con el método clásico (tienda 1 + bodega 2), sin dejar reservado'); }

// ── Categorías de la tienda
{ db.clear();
  const P = (codigo, nombre, categoria, pub = true, estado = 'bodega') => db.set(k('stock', codigo), { codigo, nombre, nombre_base: nombre, categoria, enCatalogo: pub, estado, stock_bodega: 1, stock_tienda: 0, stock_consignacion: 0, stock_total: 1 });
  P('ANP001T6', 'Anillo Luna Dúo', 'CJ');            // anillo dúo mal puesto en Conjuntos  → AN
  P('ANP002T7', 'Alianzas Trío Clásicas', 'CJ');      // trío en Conjuntos                  → AN
  P('ANP003T8', 'Anillo Sol', 'AN');                  // bien
  P('CJP001', 'Conjunto Collar y Aretes', 'CJ');      // conjunto de verdad: bien
  P('ARP010', 'Aretes Gota', 'AN');                   // código AR en categoría AN → AR
  P('PUP020', 'Pulsera Mar', 'PU', false);            // bien (no publicada)
  P('COP030', 'Collar Estrella', '');                 // sin categoría, código CO → CO
  P('CA003', 'Cadena aros', 'CD');                    // prefijo CA no está en la tabla: no se toca
  P('ANP099', 'Anillo viejo', 'CJ', true, 'inactivo');// inactivo: se ignora
  const r = await llamar(nuevo, 'AUDITORIA_CATEGORIAS', {});
  const dud = Object.fromEntries(r.body.dudosas.map(d => [d.codigo, d.propuesta]));
  ok(r.body.ok && dud.ANP001T6 === 'AN' && dud.ANP002T7 === 'AN', 'detecta anillos dúo y trío puestos en «Conjuntos» y propone «Anillos»');
  ok(dud.ARP010 === 'AR' && dud.COP030 === 'CO', 'detecta categoría que no coincide con el código, y productos sin categoría');
  ok(!('ANP003T8' in dud) && !('CJP001' in dud) && !('PUP020' in dud) && !('CA003' in dud) && !('ANP099' in dud), 'NO marca lo que está bien: anillo en AN, conjunto real en CJ, pulsera, prefijo desconocido ni inactivos');
  ok(r.body.porCategoria.CJ === 3 && r.body.porCategoria.AN === 2 && r.body.publicados === 7, 'cuenta lo publicado por categoría: ' + JSON.stringify(r.body.porCategoria));
  const c = await llamar(nuevo, 'CORREGIR_CATEGORIAS', { cambios: [{ codigo: 'ANP001T6', categoria: 'an' }, { codigo: 'ANP002T7', categoria: 'AN' }, { codigo: 'NOEXISTE', categoria: 'AN' }, { codigo: 'ARP010', categoria: 'ZZ' }] });
  ok(c.body.ok && db.get(k('stock', 'ANP001T6')).categoria === 'AN' && db.get(k('stock', 'ANP002T7')).categoria === 'AN' && c.body.noExisten.join() === 'NOEXISTE', 'corrige las categorías pedidas (acepta minúsculas) e informa las que no existen');
  ok(db.get(k('stock', 'ARP010')).categoria === 'AN', 'una categoría inválida (ZZ) se ignora: no se toca el producto');
  ok(db.get(k('stock', 'ANP001T6')).stock_bodega === 1 && db.get(k('stock', 'ANP001T6')).enCatalogo === true, 'corregir la categoría no cambia stock ni visibilidad');
  const r2 = await llamar(nuevo, 'AUDITORIA_CATEGORIAS', {}); ok(!r2.body.dudosas.some(d => d.codigo.startsWith('ANP00')), 'tras corregir, esos anillos ya no salen como dudosos');
  const m = await llamar(nuevo, 'CORREGIR_CATEGORIAS', { cambios: [{ codigo: 'ARP010', categoria: 'AR' }] }, 'mala'); ok(m.status === 403 && db.get(k('stock', 'ARP010')).categoria === 'AN', 'sin clave de admin: 403 y nada cambia'); }

console.log(`\n${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0);
