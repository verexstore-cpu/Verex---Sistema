// Recupera la foto de un producto aunque ImageKit no la pueda mostrar (demasiado grande):
// prueba el original sin procesar (orig-true) y la miniatura; guarda lo que consiga en salida/.
import { writeFileSync, mkdirSync } from "node:fs";
const URL_FOTO = process.env.FOTO;
mkdirSync("salida", { recursive: true });
const base = URL_FOTO.split("?")[0];
for (const [nombre, u] of [["original", base + "?tr=orig-true"], ["miniatura", base + "?tr=n-ik_ml_thumbnail"]]) {
  const r = await fetch(u);
  const b = Buffer.from(await r.arrayBuffer());
  console.log(nombre, r.status, r.headers.get("content-type"), b.length, "bytes");
  if (r.ok && b.length > 1000) writeFileSync(`salida/${nombre}.jpg`, b);
}
