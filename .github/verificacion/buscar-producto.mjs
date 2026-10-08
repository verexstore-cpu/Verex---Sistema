// Busca un producto publicado (GET_CATALOGO, lo mismo que lee la tienda) por cualquier texto:
// nombre, nombre en inglés, código, descripción… y revisa si su foto abre.
const Q = String(process.env.BUSCAR || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const r = await fetch("https://verex-api.verexstore.workers.dev/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "GET_CATALOGO" }) });
const d = await r.json();
const prods = d.productos || [];
console.log(`Catálogo publicado: ${prods.length} registros`);
const hits = prods.filter(p => Q.some(q => JSON.stringify(p).toLowerCase().includes(q)));
const campos = ["codigo", "codigoBase", "nombre", "nombre_base", "nombreEN", "nombreTiendaEN", "nombreEn", "categoria", "material", "precio", "talla", "stock_tienda", "stock_bodega", "reservado", "destacado", "foto", "fotoMejorada", "img"];
async function estadoFoto(u) { if (!u) return "SIN FOTO"; try { const x = await fetch(u, { method: "GET" }); return `HTTP ${x.status} ${x.headers.get("content-type") || ""} ${x.headers.get("content-length") || ""}`; } catch (e) { return "ERROR " + e.message; } }
let md = `## Búsqueda: ${Q.join(", ")}\n\n${hits.length} coincidencias de ${prods.length}\n\n`;
for (const p of hits) {
  console.log("\n────────────");
  const fila = {};
  for (const k of campos) if (p[k] !== undefined && p[k] !== "") fila[k] = p[k];
  for (const [k, v] of Object.entries(p)) if (typeof v === "string" && Q.some(q => v.toLowerCase().includes(q)) && !(k in fila)) fila[k] = v.slice(0, 200);
  console.log(JSON.stringify(fila, null, 1));
  const ef = await estadoFoto(p.foto), em = p.fotoMejorada ? await estadoFoto(p.fotoMejorada) : "";
  console.log("foto:", ef, em ? " | fotoMejorada: " + em : "");
  md += `### ${p.codigo} — ${p.nombre || ""}\n\n\`\`\`json\n${JSON.stringify(fila, null, 1)}\n\`\`\`\nfoto: ${ef}${em ? " · mejorada: " + em : ""}\n\n`;
}
if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
