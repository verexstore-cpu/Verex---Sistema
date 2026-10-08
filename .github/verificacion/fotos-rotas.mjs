// Revisa TODAS las fotos del inventario activo y lista las que ImageKit no puede mostrar.
const api = async accion => (await fetch("https://verex-api.verexstore.workers.dev/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion }) })).json();
const publicados = new Set(((await api("GET_CATALOGO")).productos || []).map(p => p.codigo));
const stock = (await api("GET_STOCK")).stock || [];
const porFoto = new Map();
for (const p of stock) for (const campo of ["foto", "fotoMejorada"]) { const u = p[campo]; if (u && /^https?:/.test(u)) { if (!porFoto.has(u)) porFoto.set(u, []); porFoto.get(u).push({ p, campo }); } }
console.log(`Inventario: ${stock.length} · fotos distintas: ${porFoto.size}`);
const urls = [...porFoto.keys()], malas = [];
let i = 0;
async function trabajador() { while (i < urls.length) { const u = urls[i++]; let st = 0; try { const r = await fetch(u, { method: "GET" }); st = r.status; await r.arrayBuffer(); } catch (_) { st = -1; } if (st !== 200) malas.push({ u, st }); } }
await Promise.all(Array.from({ length: 12 }, trabajador));
const filas = [];
for (const { u, st } of malas) for (const { p, campo } of porFoto.get(u)) filas.push({ codigo: p.codigo, nombre: p.nombre || "", campo, st, estado: p.estado, stock: (+p.stock_tienda || 0) + (+p.stock_bodega || 0), publicado: publicados.has(p.codigo), u });
filas.sort((a, b) => a.codigo.localeCompare(b.codigo));
console.log(`\nFotos que NO se ven: ${malas.length} (afectan ${filas.length} registros)\n`);
for (const f of filas) console.log(`${f.codigo}\t${f.nombre}\t${f.campo}\tHTTP ${f.st}\t${f.estado}\tstock ${f.stock}${f.publicado ? "\tPUBLICADO" : ""}\t${f.u}`);
