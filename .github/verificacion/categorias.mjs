// Qué categoría tiene guardada cada producto publicado y qué prefijo de código usa.
const api = async accion => (await fetch("https://verex-api.verexstore.workers.dev/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion }) })).json();
const d = await api("GET_CATALOGO");
const prods = d.productos || [];
console.log("config.categorias:", JSON.stringify(d.config?.categorias || null));
const t = {};
for (const p of prods) { const k = `categoria=${JSON.stringify(p.categoria ?? null)} prefijo=${String(p.codigoBase || p.codigo).slice(0, 2)}`; (t[k] = t[k] || []).push(p.codigo); }
for (const [k, v] of Object.entries(t).sort()) console.log(k, "→", v.length, v.slice(0, 12).join(" "));
const st = (await api("GET_STOCK")).stock || [];
const t2 = {};
for (const p of st) { const k = `categoria=${JSON.stringify(p.categoria ?? null)} prefijo=${String(p.codigoBase || p.codigo).slice(0, 2)}`; t2[k] = (t2[k] || 0) + 1; }
console.log("\nInventario completo:"); for (const [k, v] of Object.entries(t2).sort()) console.log(k, "→", v);
