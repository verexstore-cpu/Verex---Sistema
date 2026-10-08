// Recupera fotos que ImageKit no puede mostrar (demasiado grandes): baja el original sin procesar (orig-true).
// FOTOS = "NOMBRE=url,NOMBRE=url"
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("salida", { recursive: true });
for (const par of String(process.env.FOTOS || "").split(",").filter(Boolean)) {
  const [nombre, url] = par.split("=");
  const r = await fetch(url.split("?")[0] + "?tr=orig-true");
  const b = Buffer.from(await r.arrayBuffer());
  console.log(nombre, r.status, r.headers.get("content-type"), b.length, "bytes");
  if (r.ok && b.length > 1000) writeFileSync(`salida/${nombre}.${/png/.test(r.headers.get("content-type") || "") ? "png" : "jpg"}`, b);
}
