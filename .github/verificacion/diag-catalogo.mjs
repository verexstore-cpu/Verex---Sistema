// Diagnóstico de un catálogo de vendedor (/c/<slug>) en producción: ¿por qué dice "Link inválido"?
// No imprime datos personales: solo estado, estructura y el punto exacto donde falla.
const slugs = (process.env.SLUGS || "xiomara").split(",").map(s => s.trim()).filter(Boolean);
for (const slug of slugs) {
  const url = `https://admin-tienda.pages.dev/c/${encodeURIComponent(slug)}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 VEREX-diag" } });
  const html = await r.text();
  console.log(`\n== ${url} → HTTP ${r.status} · ${html.length} bytes · título: ${(html.match(/<title>([^<]*)<\/title>/) || [])[1] || "-"}`);
  if (/Catálogo no encontrado/.test(html)) { console.log("   KV: NO existe un catálogo con ese id"); continue; }
  const m = html.match(/window\.__CATALOG_DATA__ = ([\s\S]*?);<\/script>/);
  if (!m) { console.log("   ❌ la página NO trae window.__CATALOG_DATA__ (plantilla sin </head>?) · tiene </head>: " + html.includes("</head>")); continue; }
  const txt = m[1];
  console.log(`   datos inyectados: ${txt.length} caracteres · empieza: ${JSON.stringify(txt.slice(0, 40))}`);
  let data;
  try { data = JSON.parse(txt); } catch (e) {
    const pos = parseInt((String(e.message).match(/position (\d+)/) || [])[1] || "-1", 10);
    console.log(`   ❌ JSON inválido: ${e.message}`);
    if (pos >= 0) console.log(`   alrededor del error: ${JSON.stringify(txt.slice(Math.max(0, pos - 80), pos + 80))}`);
    try { new Function(`return (${txt})`)(); console.log("   (pero como JavaScript sí se evalúa)"); } catch (e2) { console.log(`   como JavaScript también falla: ${e2.message}`); }
    continue;
  }
  console.log(`   ✅ JSON válido · tipo: ${typeof data}${data === null ? " (null!)" : ""}`);
  if (data && typeof data === "object") {
    console.log(`   claves: ${Object.keys(data).join(", ")}`);
    console.log(`   prods: ${Array.isArray(data.prods) ? data.prods.length : "NO es lista (" + typeof data.prods + ")"} · afiliado: ${data.afiliado} · tipoCatalogo: ${data.tipoCatalogo || "-"}`);
    if (data.expiry) console.log(`   vence: ${new Date(data.expiry).toISOString()} · ${data.expiry < Date.now() ? "VENCIDO" : "vigente"}`);
    if (typeof data === "string") console.log("   ❌ los datos son un string, no un objeto (doble JSON)");
  }
  // ¿El reemplazo de </head> rompió algo? ($&, $' y $` son especiales en String.replace)
  console.log(`   contiene "$&", "$'" o "$\`": ${/\$[&'`]/.test(txt)}`);
}
