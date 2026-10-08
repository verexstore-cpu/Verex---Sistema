// Verifica en producción el «catálogo actual del vendedor» (consignación + afiliado).
// Reintenta unos minutos mientras Cloudflare Pages termina de publicar.
const espera = ms => new Promise(r => setTimeout(r, ms));
async function hasta(nombre, fn, intentos = 18) {
  for (let i = 0; i < intentos; i++) { const r = await fn().catch(e => ({ ok: false, d: e.message })); if (r.ok) { console.log("✅", nombre, r.d || ""); return true; } if (i === intentos - 1) { console.log("❌", nombre, r.d || ""); return false; } await espera(10000); }
}
const ok = [];
ok.push(await hasta("admin-tienda: /seller-catalog publicado y protegido (sin contraseña → 403)", async () => {
  const r = await fetch("https://admin-tienda.pages.dev/seller-catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendedor: { codigo: "X", nombre: "prueba" } }) });
  const t = await r.text(); return { ok: r.status === 403 && /No autorizado/.test(t), d: `HTTP ${r.status} ${t.slice(0, 60)}` };
}));
ok.push(await hasta("admin-tienda: catalogo.html con «✓ DISPONIBLE YA»", async () => {
  const t = await (await fetch(`https://admin-tienda.pages.dev/catalogo.html?v=${Date.now()}`)).text(); return { ok: t.includes("card-enmano-badge") && t.includes("_esMixto") };
}));
ok.push(await hasta("Nexus: botón «Ver Catálogo Actual» usa el catálogo al día", async () => {
  const t = await (await fetch(`https://verex-nexus.pages.dev/js/hub-02.js?v=${Date.now()}`)).text(); return { ok: t.includes("/seller-catalog"), d: t.length + " bytes" };
}));
console.log(`\n${ok.filter(Boolean).length}/${ok.length}`); process.exit(ok.every(Boolean) ? 0 : 1);
